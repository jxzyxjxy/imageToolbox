/**
 * 视频链接解析（取回无水印原片）：当前支持抖音分享链接 + 视频直链。
 * event: { text } —— 分享文案或链接（≤2000 字符）
 *
 * 流程：提取 URL → 识别平台 → 解析无水印源（原生 https，Node16 无全局 fetch）
 *       → 拉取视频流转存云存储（绕开小程序 downloadFile 域名白名单）
 *       → 返回 fileID（前端 downloadTemp + saveVideoToPhotosAlbum 保存）
 *
 * 转存路径 yt/results/...（yt_cleanup 定时清理，保留 7 天），
 * 登记 yt_storage_files 集合（与 yt_generate/lib/storage.js 同约定）。
 * 返回: { ok, videoFileID, coverFileID, title, size, note, error? }
 *
 * 支持平台（按 URL 识别）：
 *   抖音   douyin.com / iesdouyin.com  —— share 页 SSR 数据（ttwid 对抗 spider）
 *   豆包   doubao.com/video-sharing     —— POST /creativity/share/get_video_share_info
 *   可灵   klingai.com/h5-app/share     —— GET  /api/app/creatives/query（免签名）
 *   其他   .mp4 等视频直链直接转存
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const DOUYIN_REFERER = 'https://www.douyin.com/';
const PAGE_TIMEOUT = 12000;
const DOWNLOAD_TIMEOUT = 30000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- HTTP 工具（原生 https，手动跟随重定向） ---------------- */

/** GET 请求（页面级，小文件整包读取）；返回 { status, finalUrl, body } */
function requestPage(urlStr, timeoutMs = PAGE_TIMEOUT, maxRedirects = 5, cookie = '') {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const headers = { 'User-Agent': MOBILE_UA, Referer: DOUYIN_REFERER };
    if (cookie) headers.Cookie = cookie;
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          res.resume();
          const next = new URL(res.headers.location, urlStr).toString();
          requestPage(next, timeoutMs, maxRedirects - 1, cookie).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, finalUrl: urlStr, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

/** 带重试的页面抓取：目标站偶发连接重置，最多重试 2 次 */
async function fetchPage(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await requestPage(url);
      if (res.status === 200) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** 大文件下载（流式计数限流）；下载失败原因交由调用方友好化 */
function downloadBuffer(urlStr, timeoutMs = DOWNLOAD_TIMEOUT, maxBytes = MAX_VIDEO_BYTES, referer = DOUYIN_REFERER) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: referer ? { 'User-Agent': MOBILE_UA, Referer: referer } : { 'User-Agent': MOBILE_UA },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          downloadBuffer(new URL(res.headers.location, urlStr).toString(), timeoutMs, maxBytes)
            .then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`视频源响应 HTTP ${res.statusCode}`));
          return;
        }
        const declared = Number(res.headers['content-length'] || 0);
        if (declared > maxBytes) {
          res.resume();
          reject(new Error('视频超过 200MB，暂不支持'));
          return;
        }
        const chunks = [];
        let total = 0;
        let aborted = false;
        res.on('data', (c) => {
          total += c.length;
          if (total > maxBytes) {
            if (!aborted) {
              aborted = true;
              req.destroy(new Error('视频超过 200MB，暂不支持'));
            }
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (!aborted) resolve(Buffer.concat(chunks));
        });
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
  });
}

/* ---------------- 链接与平台识别 ---------------- */

/** POST JSON 请求（返回原始 headers，供 set-cookie 提取） */
function requestPostJson(urlStr, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = Buffer.from(JSON.stringify(bodyObj));
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          'User-Agent': MOBILE_UA,
        },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/* ---------------- ttwid 设备凭证（字节统一注册服务，免费无配置） ----------------
 * 抖音对无 cookie 的数据中心请求按 spider 处理：share 页返回剥离视频数据的壳
 * （loaderData 仅页面元信息，无 play_addr）。注册 ttwid 后视为正常设备。
 */
let ttwidCache = null;

async function ensureTtwid() {
  if (ttwidCache) return ttwidCache;
  try {
    const res = await requestPostJson('https://ttwid.bytedance.com/ttwid/union/register/', {
      region: 'cn',
      aid: 1768,
      needFid: false,
      service: 'www.ixigua.com',
      migrate_info: { ticket: '', source: 'node' },
      cbUrlProtocol: 'https',
      union: true,
    });
    const cookies = (res.headers && res.headers['set-cookie']) || [];
    const hit = cookies.find((c) => c.startsWith('ttwid='));
    if (hit) {
      ttwidCache = hit.split(';')[0];
      return ttwidCache;
    }
  } catch (e) {
    /* 注册失败不阻断解析，退化为无 cookie 请求 */
  }
  return null;
}

/** 从整段分享文案中提取第一个 URL */
function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s<>"'`）)\]，】]+/i);
  return m ? m[0].replace(/[.,;!?。，；！？、]+$/, '') : null;
}

/* ---------------- 抖音解析（移植自 video-toolbox/server/parsers/douyin.ts） ---------------- */

/** 在任意嵌套对象中查找第一个包含 url_list 的 play_addr 节点 */
function findPlayAddr(node, depth = 0) {
  if (depth > 12 || node === null || typeof node !== 'object') return null;
  const obj = node;
  for (const key of ['play_addr', 'playAddr']) {
    const cand = obj[key];
    if (cand && Array.isArray(cand.url_list) && cand.url_list.length > 0) {
      return cand;
    }
  }
  for (const value of Object.values(obj)) {
    if (typeof value === 'object') {
      const found = findPlayAddr(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findStringField(node, keys, depth = 0) {
  if (depth > 10 || node === null || typeof node !== 'object') return undefined;
  const obj = node;
  for (const key of keys) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key];
  }
  for (const value of Object.values(obj)) {
    if (typeof value === 'object') {
      const found = findStringField(value, keys, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

/** 封面地址：cover 字段为字符串时直取，为 {url_list:[…]} 对象时取首项 */
function findCoverUrl(node, keys = ['cover', 'origin_cover', 'originCover'], depth = 0) {
  if (depth > 10 || node === null || typeof node !== 'object') return '';
  for (const key of keys) {
    const v = node[key];
    if (typeof v === 'string' && v) return v;
    if (v && typeof v === 'object') {
      const list = Array.isArray(v.url_list) ? v.url_list : Array.isArray(v) ? v : null;
      if (list && typeof list[0] === 'string' && list[0]) return list[0];
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findCoverUrl(value, keys, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

/** 无水印地址：playwm 域名为水印流，play 域名为无水印流 */
function toNoWatermark(url) {
  return url.replace(/playwm/g, 'play').replace(/^http:\/\//, 'https://');
}

/**
 * 抖音下载候选集。播放接口族对机房 IP 有整体下线/风控（404 len=0），
 * 单一 url_list[0] 命中率不稳，用 uri 拼多组接口/清晰度变体提高容错。
 * 404 为路径级拒绝（立即返回），不会显著拉长耗时。
 */
function buildDouyinPlayCandidates(playAddr) {
  const cands = [];
  const urls = playAddr && Array.isArray(playAddr.url_list) ? playAddr.url_list : [];
  for (const u of urls) {
    if (!u) continue;
    cands.push(toNoWatermark(u));
    cands.push(u);
  }
  const uri = playAddr && playAddr.uri;
  if (uri && /^v\w{4}/.test(uri)) {
    cands.push(`https://www.iesdouyin.com/aweme/v1/play/?video_id=${uri}&ratio=1080p&line=0`);
    cands.push(`https://aweme.snssdk.com/aweme/v1/play/?video_id=${uri}&ratio=540p&line=0`);
  }
  return [...new Set(cands)].slice(0, 5);
}

/** 从 share 页 HTML 解析视频数据（_ROUTER_DATA 或 RENDER_DATA） */
function extractFromHtml(html) {
  const routerMatch = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (routerMatch) {
    try {
      const data = JSON.parse(routerMatch[1]);
      const pa = findPlayAddr(data);
      const play = pa && pa.url_list && pa.url_list[0];
      if (play) {
        return {
          play: toNoWatermark(play),
          playFallbacks: buildDouyinPlayCandidates(pa),
          title: findStringField(data, ['desc', 'title']),
          cover: findCoverUrl(data),
        };
      }
    } catch (e) {
      /* 尝试下一路径 */
    }
  }
  const renderMatch = html.match(/<script id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/);
  if (renderMatch) {
    try {
      const data = JSON.parse(decodeURIComponent(renderMatch[1]));
      const pa = findPlayAddr(data);
      const play = pa && pa.url_list && pa.url_list[0];
      if (play) {
        return {
          play: toNoWatermark(play),
          playFallbacks: buildDouyinPlayCandidates(pa),
          title: findStringField(data, ['desc', 'title']),
          cover: findCoverUrl(data),
        };
      }
    } catch (e) {
      /* 解析失败 */
    }
  }
  return null;
}

/** 提取 aweme_id：/video/xxx、/note/xxx、modal_id=xxx、aweme_id=xxx */
function extractAwemeId(url) {
  const patterns = [/\/(?:video|note)\/(\d+)/, /modal_id=(\d+)/, /aweme_id=(\d+)/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/** 抖音过滤原因码 → 用户可读文案（未知码原样透出） */
const FILTER_REASON_MAP = {
  SYSTEM_ITEM_NOT_EXIST: '视频不存在或已被删除',
  AWEME_PRE_DOWN: '视频暂不可见（作者设置了隐私权限）',
  SYSTEM_ITEM_REVIEWING: '视频审核中，暂不可访问',
  AWEME_PRIVATE: '视频为私密作品，无法取回',
};

function extractFilterReason(html) {
  const m = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    const loader = data.loaderData || {};
    for (const key of Object.keys(loader)) {
      const page = loader[key];
      const fl = page && page.videoInfoRes && page.videoInfoRes.filter_list;
      if (Array.isArray(fl) && fl.length && fl[0].filter_reason) {
        const code = fl[0].filter_reason;
        return FILTER_REASON_MAP[code] || code;
      }
    }
  } catch (e) {
    /* 忽略解析异常 */
  }
  return null;
}

async function parseDouyin(url) {
  // 1. 跟随短链重定向，拿真实地址
  const page = await fetchPage(url);
  const awemeId = extractAwemeId(page.finalUrl) || extractAwemeId(url);
  if (!awemeId) {
    return { ok: false, error: '未能识别视频 ID，请确认分享链接完整' };
  }
  // 2. 注册设备凭证（免费，失败不阻断）
  let cookie = '';
  try {
    cookie = (await ensureTtwid()) || '';
  } catch (e) {
    /* 退化为无 cookie 请求 */
  }
  // 3. 依次尝试 share 页与主站页
  const pageUrls = [
    `https://www.iesdouyin.com/share/video/${awemeId}`,
    `https://www.douyin.com/video/${awemeId}`,
  ];
  let lastFilter = null;
  for (const pageUrl of pageUrls) {
    try {
      const res = await requestPage(pageUrl, PAGE_TIMEOUT, 5, cookie);
      if (res.status !== 200) continue;
      const html = res.body.toString('utf8');
      const extracted = extractFromHtml(html);
      if (extracted) {
        // 抖音播放接口对机房 IP 关闭（404），视频由小程序端直接下载（走用户网络）
        return { ok: true, ...extracted, clientDownload: true, note: '已取回无水印原片' };
      }
      lastFilter = extractFilterReason(html) || lastFilter;
    } catch (e) {
      /* 尝试下一个页面 */
    }
  }
  const detail = lastFilter ? `（${lastFilter}）` : '';
  return { ok: false, error: `抖音页面解析失败${detail}，请稍后重试` };
}

/* ---------------- 豆包（doubao.com/video-sharing） ----------------
 * 分享页为纯 SPA 无 SSR，数据经 POST /creativity/share/get_video_share_info
 * 获取（免登录、免签名，仅需 share_id + vid 参数）。返回 play_info.main 为
 * 字节视频 CDN 直链（mp4），poster_url 为封面，prompt 为用户生成提示词。
 * 平台自有 get_without_watermark 接口需登录态，此处取分享流。
 */
async function parseDoubao(url) {
  const u = new URL(url);
  const shareId = u.searchParams.get('share_id') || '';
  const vid = u.searchParams.get('video_id') || u.searchParams.get('vid') || '';
  if (!shareId || !vid) {
    return { ok: false, error: '豆包链接缺少分享参数，请使用 App 内「复制链接」获得的完整分享' };
  }
  const res = await requestPostJson('https://www.doubao.com/creativity/share/get_video_share_info', {
    share_id: shareId,
    vid,
    creation_id: '',
  });
  if (res.status !== 200) {
    return { ok: false, error: '豆包服务无响应，请稍后重试' };
  }
  let j;
  try {
    j = JSON.parse(res.body);
  } catch (e) {
    return { ok: false, error: '豆包响应异常，请稍后重试' };
  }
  const play = j && j.code === 0 && j.data && j.data.play_info && j.data.play_info.main;
  if (!play) {
    return { ok: false, error: '豆包视频解析失败，请确认分享链接有效（作品可能已删除）' };
  }
  const title = String((j.data && j.data.prompt) || '').slice(0, 80);
  const cover = (j.data && j.data.play_info && j.data.play_info.poster_url) || '';
  return { ok: true, play, title, cover, note: '已取回豆包分享视频', referer: 'https://www.doubao.com/' };
}

/* ---------------- 可灵（klingai.com/h5-app/share） ----------------
 * 分享页 SPA 的接口经 bundle 逆向确认：GET /api/app/creatives/query，
 * 签名 SDK 以 try/catch 包裹（失败裸发），实测免签名可通。
 * creative_type 为空时依次尝试 WORK / SKIT。响应结构未见官方文档，
 * 用递归深搜提取首个 mp4 直链兜底。
 */
const KLING_ERROR_MAP = [
  [/ReviewFailed/i, '作品在可灵平台审核未通过或已下架，无法解析'],
  [/NotFound|NotExists|NotExist/i, '分享内容不存在或已被删除'],
];

function deepFindVideoUrl(node, depth = 0) {
  if (depth > 12 || node == null) return '';
  if (typeof node === 'string') {
    return /^https?:\/\/[^\s"']+\.(mp4|m4v|mov)(\?|#|$)/i.test(node) ? node : '';
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = deepFindVideoUrl(item, depth + 1);
      if (hit) return hit;
    }
    return '';
  }
  if (typeof node === 'object') {
    // 优先在 key 含 video/resource/url 的字段里找
    const keys = Object.keys(node);
    const ordered = keys
      .filter((k) => /video|resource|url/i.test(k))
      .concat(keys.filter((k) => !/video|resource|url/i.test(k)));
    for (const k of ordered) {
      const hit = deepFindVideoUrl(node[k], depth + 1);
      if (hit) return hit;
    }
  }
  return '';
}

async function parseKling(url) {
  const u = new URL(url);
  const creativeId = u.searchParams.get('creative_id') || u.searchParams.get('work_id') || '';
  const rawType = u.searchParams.get('creative_type') || '';
  if (!creativeId) {
    return { ok: false, error: '可灵链接缺少作品 ID，请使用 App 内「复制链接」获得的完整分享' };
  }
  const types = rawType ? [rawType] : ['WORK', 'SKIT'];
  let lastDetail = '';
  for (const t of types) {
    try {
      const res = await requestPage(
        `https://klingai.com/api/app/creatives/query?creativeId=${encodeURIComponent(creativeId)}&creativeType=${encodeURIComponent(t)}`,
      );
      if (res.status !== 200) continue;
      let j;
      try {
        j = JSON.parse(res.body.toString('utf8'));
      } catch (e) {
        continue;
      }
      const play = deepFindVideoUrl(j && j.data);
      if (play) {
        const kd = j.data || {};
        const kcover = kd.cover && typeof kd.cover === 'object' ? kd.cover.resource : kd.cover;
        return {
          ok: true,
          play,
          title: String(kd.title || '').slice(0, 80),
          cover: typeof kcover === 'string' ? kcover : '',
          note: '已取回可灵分享视频',
          referer: 'https://klingai.com/',
        };
      }
      if (j && j.error && j.error.type) {
        const mapped = KLING_ERROR_MAP.find(([re]) => re.test(j.error.type));
        if (mapped) return { ok: false, error: mapped[1] };
        lastDetail = j.error.detail || j.error.type;
      }
    } catch (e) {
      /* 尝试下一个 creative_type */
    }
  }
  return {
    ok: false,
    error: lastDetail ? `可灵解析失败：${lastDetail}` : '可灵视频解析失败，请确认分享链接有效',
  };
}

/* ---------------- 即梦（jimeng.jianying.com/s/{code}） ----------------
 * /s/{code} 服务端 302 到回流页，Location 携带作品 id（短链解析在服务端完成，
 * 需手动读 302 头而非跟随）。再 POST /mweb/v1/mget_item_info {item_id_list:[id]}
 * （免登录，参数名经 bundle 逆向确认）。视频在 item.video.origin_video.video_url
 * （vlabvod 签名 CDN 直链），降级链 origin → 720p → 480p → 360p。
 */
async function parseJimeng(url) {
  const codeMatch = url.match(/jimeng\.jianying\.com\/s\/([A-Za-z0-9]+)/i);
  if (!codeMatch) {
    return { ok: false, error: '即梦链接格式不正确，请使用 App 内「复制链接」获得的完整分享' };
  }
  // 1. 短链 302，Location 携带作品 id（maxRedirects=0 不跟随）
  const res = await requestPage(`https://jimeng.jianying.com/s/${codeMatch[1]}/`, PAGE_TIMEOUT, 0, '');
  const loc = res.headers && res.headers.location;
  if (res.status !== 302 || !loc) {
    return { ok: false, error: '即梦短链解析失败，请确认分享链接有效' };
  }
  const idMatch = loc.match(/[?&]id=(\d+)/);
  if (!idMatch) {
    return { ok: false, error: '即梦短链未包含作品 ID，请重新从 App 分享' };
  }
  // 2. 查询作品详情
  const api = await requestPostJson('https://jimeng.jianying.com/mweb/v1/mget_item_info', {
    item_id_list: [idMatch[1]],
  });
  if (api.status !== 200) {
    return { ok: false, error: '即梦服务无响应，请稍后重试' };
  }
  let j;
  try {
    j = JSON.parse(api.body);
  } catch (e) {
    return { ok: false, error: '即梦响应异常，请稍后重试' };
  }
  const item = j && j.ret === '0' && j.data && j.data.effect_item_list && j.data.effect_item_list[0];
  if (!item) {
    return { ok: false, error: '即梦作品获取失败（可能已删除或审核未通过）' };
  }
  const v = item.video || {};
  const tv = v.transcoded_video || {};
  const cands = [
    v.origin_video && v.origin_video.video_url,
    tv.origin && tv.origin.video_url,
    tv['720p'] && tv['720p'].video_url,
    tv['480p'] && tv['480p'].video_url,
  ].filter(Boolean);
  if (!cands.length) {
    return { ok: false, error: '即梦作品未包含视频（可能是图片作品，暂不支持）' };
  }
  const attr = item.common_attr || {};
  const coverMap = attr.cover_url_map || {};
  const title = String(attr.description || '').slice(0, 80);
  const cover = coverMap['720'] || coverMap['480'] || attr.cover_url || '';
  return {
    ok: true,
    play: cands[0],
    playFallbacks: cands.slice(1, 3),
    title,
    cover,
    note: '已取回即梦分享视频',
    referer: 'https://jimeng.jianying.com/',
  };
}

/* ---------------- 云存储转存（对齐 yt_generate/lib/storage.js 约定） ---------------- */

function resultPath(openid, ext) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `yt/results/${String(openid).slice(-8)}/${Date.now()}_${rand}.${ext}`;
}

/** 登记临时文件（失败不阻断业务，cleanup 按记录清理） */
async function register(fileID, openid) {
  try {
    const db = cloud.database();
    const existed = await db.collection('yt_storage_files').where({ fileID }).limit(1).get();
    if (existed.data && existed.data.length > 0) return;
    await db.collection('yt_storage_files').add({
      data: { fileID, kind: 'results', openid: openid || '', createdAt: new Date() },
    });
  } catch (e) {
    console.warn('[video-parse] register failed:', e && e.errMsg ? e.errMsg : e);
  }
}

function extOf(url, fallback) {
  const m = url.match(/\.(\w{2,5})(?:\?|#|$)/i);
  const ext = m ? m[1].toLowerCase() : '';
  return ['mp4', 'm4v', 'mov', 'webm'].includes(ext) ? ext : fallback;
}

/* ---------------- 主流程 ---------------- */

exports.main = async (event) => {
  const text = String((event && event.text) || '')
    .trim()
    .slice(0, 2000);
  if (!text) return { ok: false, error: '请粘贴分享链接' };
  const url = extractUrl(text);
  if (!url) return { ok: false, error: '未识别到有效链接，请粘贴完整的分享内容' };

  let parsed;
  if (/\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(url)) {
    parsed = { ok: true, play: url, title: '', cover: '', note: '视频直链', referer: '' };
  } else if (/doubao\.com/i.test(url)) {
    try {
      parsed = await parseDoubao(url);
    } catch (err) {
      return { ok: false, error: `豆包解析失败：${err.message || '网络异常'}` };
    }
  } else if (/klingai\.com/i.test(url)) {
    try {
      parsed = await parseKling(url);
    } catch (err) {
      return { ok: false, error: `可灵解析失败：${err.message || '网络异常'}` };
    }
  } else if (/jimeng\.jianying\.com/i.test(url)) {
    try {
      parsed = await parseJimeng(url);
    } catch (err) {
      return { ok: false, error: `即梦解析失败：${err.message || '网络异常'}` };
    }
  } else if (/douyin\.com|iesdouyin\.com/i.test(url)) {
    try {
      parsed = await parseDouyin(url);
    } catch (err) {
      return { ok: false, error: `网络请求失败：${err.message || '未知错误'}` };
    }
  } else {
    return { ok: false, error: '当前支持抖音 / 豆包 / 可灵分享链接，更多平台陆续上线' };
  }
  if (!parsed.ok || !parsed.play) {
    return { ok: false, error: parsed.error || '解析失败，请检查链接' };
  }

  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID || 'guest';

  // 抖音 clientDownload 模式：播放接口对机房 IP 整体关闭（404 空响应），
  // 服务器侧无法下载。改由小程序端 Taro.downloadFile 直下（走用户手机网络，
  // 与真实设备同源，接口正常 302 到 CDN）。云函数仅转存封面（douyinpic 图床可通）。
  if (parsed.clientDownload) {
    let coverFileID = '';
    if (parsed.cover) {
      try {
        const coverBuf = await downloadBuffer(parsed.cover, 10000, 20 * 1024 * 1024, parsed.referer || '');
        if (coverBuf && coverBuf.length > 0) {
          const coverExt = extOf(parsed.cover, 'jpeg');
          const coverUpload = await cloud.uploadFile({
            cloudPath: resultPath(openid, coverExt),
            fileContent: coverBuf,
          });
          coverFileID = coverUpload.fileID;
          await register(coverFileID, openid);
        }
      } catch (e) {
        console.warn('[video-parse] douyin cover skipped:', e && e.message ? e.message : e);
      }
    }
    return {
      ok: true,
      clientDownload: true,
      play: parsed.play,
      title: parsed.title || '',
      coverFileID,
      size: 0,
      note: parsed.note || '已取回无水印原片',
    };
  }

  // 下载视频并转存云存储：主候选失败时依次尝试备用候选（接口变体）
  let videoBuf = null;
  let lastDlErr = null;
  const dlCandidates = [parsed.play].concat(Array.isArray(parsed.playFallbacks) ? parsed.playFallbacks : []);
  for (const cand of dlCandidates.slice(0, 5)) {
    try {
      const buf = await downloadBuffer(cand, DOWNLOAD_TIMEOUT, MAX_VIDEO_BYTES, parsed.referer || '');
      if (buf && buf.length > 0) {
        videoBuf = buf;
        break;
      }
    } catch (err) {
      lastDlErr = err;
      const msg = err.message || '';
      if (msg.includes('200MB')) return { ok: false, error: msg };
      if (msg.includes('超时')) continue;
    }
  }
  if (!videoBuf) {
    const msg = (lastDlErr && lastDlErr.message) || '';
    console.error('[video-parse] download failed:', msg, '| candidates:', dlCandidates.length);
    if (msg.includes('超时')) return { ok: false, error: '视频下载超时，请重试' };
    return {
      ok: false,
      error: '抖音视频下载通道当前受限（平台风控），可改用豆包/可灵分享链接，或稍后重试',
    };
  }

  const videoExt = extOf(parsed.play, 'mp4');
  const upload = await cloud.uploadFile({
    cloudPath: resultPath(openid, videoExt),
    fileContent: videoBuf,
  });
  await register(upload.fileID, openid);

  // 封面转存（可选，失败不阻断——前端有无封面兜底样式）
  let coverFileID = '';
  if (parsed.cover) {
    try {
      const coverBuf = await downloadBuffer(parsed.cover, 10000, 20 * 1024 * 1024, parsed.referer || '');
      if (coverBuf && coverBuf.length > 0) {
        const coverExt = extOf(parsed.cover, 'jpeg');
        const coverUpload = await cloud.uploadFile({
          cloudPath: resultPath(openid, coverExt),
          fileContent: coverBuf,
        });
        coverFileID = coverUpload.fileID;
        await register(coverFileID, openid);
      }
    } catch (e) {
      console.warn('[video-parse] cover skipped:', e && e.message ? e.message : e);
    }
  }

  return {
    ok: true,
    videoFileID: upload.fileID,
    coverFileID,
    title: parsed.title || '',
    size: videoBuf.length,
    note: parsed.note || '',
  };
};

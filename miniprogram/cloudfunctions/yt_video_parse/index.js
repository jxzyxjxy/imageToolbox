/**
 * 视频链接解析（取回无水印原片）：当前支持抖音 / 豆包 / 可灵 / 即梦 / B站分享链接 + 视频直链。
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
 *   抖音   douyin.com / iesdouyin.com  —— share 页 SSR 数据；播放接口机房 IP 不可达，
 *                                           clientDownload 模式（前端直下）
 *   豆包   doubao.com/thread/          —— SSR fallback_api + qAAB 解密（无水印原片）
 *   豆包   doubao.com/video-sharing     —— 【v13】自研链路直下（ZACAO_ENABLED=1
 *                                           可切聚合通道优先）；DOUBAO_COOKIE(S)
 *                                           登录态 get_play_info 直出 lr=unwatermarked
 *                                           原画流，或 fplay 改参重放；官方游客态仅
 *                                           水印流（穷举实证）；全部 clientDownload 直下
 *   可灵   klingai.com/h5-app/share     —— GET  /api/app/creatives/query（免签名）
 *   即梦   jimeng.jianying.com/s/{code} —— 302 取 id → POST /mweb/v1/mget_item_info
 *   B站    bilibili.com / b23.tv        —— pagelist 取 cid + playurl(platform=html5)
 *                                           游客态直出 720P mp4（无签名；view 族
 *                                           接口对机房 IP 412，故走 pagelist），
 *                                           CDN 域名变体多 → 云函数转存模式
 *   其他   .mp4 等视频直链直接转存
 *
 * 豆包自备凭证：DOUBAO_COOKIE / DOUBAO_COOKIES（豆包网页端登录 Cookie，浏览器 F12
 * 复制整行 Cookie；多账号换行分隔自动轮询分摊量级）。登录态调
 * POST /samantha/video/get_play_info {"vid"} 直出无水印原画流；无直链时对 fplay
 * 形态 URL 改 logo_type=unwatermarked 重放切换无水印转码——完全不依赖第三方。
 * 聚合通道（zacao）v13 改为 ZACAO_ENABLED=1 开关控制（默认关闭走自研直链，
 * 验证通过后控制台加变量即恢复，见下方注释块）。
 *
 * clientDownload 通用降级：任何平台云函数下载失败（CDN 风控）时，
 * 自动降级为返回 play/playNoMark 直链由小程序端直下，不再向前端报死错误。
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
/** 豆包链路专用：桌面 Chrome UA（fplay 改参重放实测要求浏览器 UA，Referer 必须为空） */
const DOUBAO_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const DOUBAO_HEADERS = { 'User-Agent': DOUBAO_DESKTOP_UA, Referer: '' };
const DOUYIN_REFERER = 'https://www.douyin.com/';
const PAGE_TIMEOUT = 12000;
const DOWNLOAD_TIMEOUT = 30000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 云函数版本戳：前端展示，用于确认线上跑的是最新代码（部署后应显示 v13） */
const FN_VERSION = 'v13';

/* ---------------- HTTP 工具（原生 https，手动跟随重定向） ---------------- */

/** GET 请求（页面级，小文件整包读取）；返回 { status, finalUrl, body }
 * extraHeaders 可覆盖默认头（Referer 传空串则不发，豆包 fplay 实测带 Referer 会被拒） */
function requestPage(urlStr, timeoutMs = PAGE_TIMEOUT, maxRedirects = 5, cookie = '', extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const headers = { 'User-Agent': MOBILE_UA, Referer: DOUYIN_REFERER, ...extraHeaders };
    if (!headers.Referer) delete headers.Referer;
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
function requestPostJson(urlStr, bodyObj, extraHeaders, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = Buffer.from(JSON.stringify(bodyObj));
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          'User-Agent': MOBILE_UA,
          ...(extraHeaders || {}),
        },
        timeout: timeoutMs || 10000,
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
/* ---------------- 豆包对话分享（/thread/，无水印） ----------------
 * 移植自开源项目 ihmily/doubao-nomark（MIT）的验证方案：
 *   1. thread 页 SSR 数据（data-script-src="modern-run-router-data-fn" 的
 *      script data-fn-args JSON）里递归提取 fallback_api（/video/fplay/ 接口）；
 *   2. 给其 query 强制加 {codec_type:'8', logo_type:'unwatermarked'} → 无水印源；
 *   3. 响应 video_list 选分辨率×码率最大的条目，main_url 是 qAAB 加密 token，
 *      用响应里的 key_seed 派生 AES-128-CBC 密钥解密出真实 CDN 直链。
 */
const QAAB_SALT = Buffer.from(
  '4dd4c2e6b83162090e52b3c7a6733ba4' +
    '1cb2462b829ab58a196b39db57177524' +
    'f49baf7f08e8d68d26a72e37c1a95a2f' +
    '1f05a51892aef2949732b62a38aadd58',
  'hex',
);
const FALLBACK_HOST_SUFFIXES = ['.snssdk.com', '.douyinvod.com', '.dola.com', '.byteintlapi.com'];

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch (e) {
    return false;
  }
}

/** 宽松 base64 解码（豆包 token 使用 $@# 做 +/= 的变体替换） */
function decodeBase64Loose(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const variants = [
    text,
    text.replace(/\$/g, '_').replace(/@/g, '/').replace(/#/g, '.'),
    text.replace(/\$/g, '+').replace(/@/g, '/').replace(/#/g, '='),
  ];
  const seen = new Set();
  for (const candidate of variants) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const normalized = candidate.replace(/-/g, '+').replace(/_/g, '/');
    // 对齐 Python b64decode(validate=True)：含非法 base64 字符的变体直接跳过
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) continue;
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    try {
      const buf = Buffer.from(padded, 'base64');
      if (buf.length > 0) return buf;
    } catch (e) {
      /* 尝试下一个变体 */
    }
  }
  return null;
}

/** 解码结果必须是可打印 ASCII 的 http URL 才有效 */
function urlFromBytes(value) {
  if (!value || value.length === 0) return '';
  for (const byte of value) {
    if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) return '';
  }
  const url = value.toString('ascii').trim();
  return isHttpUrl(url) ? url : '';
}

function stripPkcs7(value) {
  if (!value || value.length === 0) return Buffer.alloc(0);
  const padding = value[value.length - 1];
  if (padding < 1 || padding > 16 || padding > value.length) return value;
  for (let i = value.length - padding; i < value.length; i++) {
    if (value[i] !== padding) return value;
  }
  return value.subarray(0, value.length - padding);
}

function decryptAesCbcUrl(payload, key, iv) {
  if (!payload || payload.length === 0 || payload.length % 16 !== 0) return '';
  try {
    const Decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    Decipher.setAutoPadding(false);
    const plaintext = Buffer.concat([Decipher.update(payload), Decipher.final()]);
    return urlFromBytes(plaintext) || urlFromBytes(stripPkcs7(plaintext));
  } catch (e) {
    return '';
  }
}

/** qAAB 加密 token 解密（key_seed 派生密钥） */
function decodeQaabToken(token, keySeed) {
  const data = decodeBase64Loose(token);
  const seed = decodeBase64Loose(keySeed);
  if (!data || !seed) return '';
  const firstDigest = crypto.createHash('sha512').update(seed.subarray(0, 32)).digest();
  const material = crypto.createHash('sha512').update(Buffer.concat([firstDigest, QAAB_SALT])).digest();
  const key = material.subarray(0, 16);
  const iv = material.subarray(16, 32);
  const attempts = [];
  if (data.subarray(0, 4).equals(Buffer.from([0xa8, 0x00, 0x01, 0x00]))) {
    attempts.push([data.subarray(4), key, iv], [data.subarray(4), iv, key]);
    if (data.length > 36) {
      attempts.push([data.subarray(36), key, data.subarray(20, 36)], [data.subarray(36), key, iv]);
    }
  } else {
    attempts.push([data, key, iv]);
  }
  for (const [payload, attemptKey, attemptIv] of attempts) {
    const url = decryptAesCbcUrl(payload, attemptKey, attemptIv);
    if (url) return url;
  }
  return '';
}

/** main_url 三态解码：明文 URL / base64 包裹 URL / qAAB 加密 */
function decodeMainUrl(token, keySeed = '') {
  const t = String(token || '').trim();
  if (isHttpUrl(t)) return t;
  const decoded = decodeBase64Loose(t);
  const plain = urlFromBytes(decoded || Buffer.alloc(0));
  if (plain) return plain;
  if (t.startsWith('qAAB') && keySeed) return decodeQaabToken(t, keySeed);
  return '';
}

/** 校验并改写 fallback_api：强制 {codec_type:'8', logo_type:'unwatermarked'} */
function buildUnwatermarkedUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch (e) {
    return '';
  }
  if (u.protocol !== 'https:') return '';
  const host = (u.hostname || '').toLowerCase();
  const trusted = FALLBACK_HOST_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s));
  if (!trusted || !u.pathname.startsWith('/video/fplay/')) return '';
  u.searchParams.delete('codec_type');
  u.searchParams.delete('logo_type');
  u.searchParams.set('codec_type', '8');
  u.searchParams.set('logo_type', 'unwatermarked');
  return u.toString();
}

/** thread 页 SSR 数据（data-fn-args JSON）递归提取全部 fallback_api
 * 注意：大块 SSR 数据的 data-fn-args 属性可能用单引号包裹（实测 2026-11
 * doubao.com/thread/{token} 页面），正则需同时兼容单/双引号，否则整段
 * 数据被跳过（提取数为 0）。 */
function extractFallbackApis(pageHtml) {
  const found = [];
  const seen = new Set();
  const scriptRe = /<script\b[^>]*data-script-src="(?:modern-run-router-data-fn|modern-run-window-fn)"[^>]*>/g;
  const argsRe = /data-fn-args=(?:"([\s\S]*?)"|'([\s\S]*?)')/;
  let scriptMatch;
  while ((scriptMatch = scriptRe.exec(pageHtml)) !== null) {
    const tag = scriptMatch[0];
    const argsMatch = tag.match(argsRe);
    if (!argsMatch) continue;
    let jsonText = argsMatch[1] !== undefined ? argsMatch[1] : argsMatch[2];
    if (!jsonText) continue;
    try {
      jsonText = jsonText
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      const root = JSON.parse(jsonText);
      const walk = (value, depth) => {
        if (depth > 30 || value == null) return;
        if (Array.isArray(value)) {
          for (const item of value) walk(item, depth + 1);
          return;
        }
        if (typeof value === 'object') {
          const fa = value.fallback_api;
          if (typeof fa === 'string') {
            // SSR 字符串里的 URL 可能残留 \u0026 / \/ 转义（JSON.parse 后仍可能有
            // 二次转义形态），统一清洗后再去重（ihmily/doubao-nomark 同款处理）
            const cleaned = fa.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
            if (!seen.has(cleaned)) {
              seen.add(cleaned);
              found.push(cleaned);
            }
          }
          for (const k of Object.keys(value)) walk(value[k], depth + 1);
          return;
        }
        if (typeof value === 'string') {
          const trimmed = value.trimStart();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              walk(JSON.parse(trimmed), depth + 1);
            } catch (e) {
              /* 非 JSON 字符串忽略 */
            }
          }
        }
      };
      walk(root, 0);
    } catch (e) {
      continue;
    }
  }
  return found;
}

async function parseDoubaoThread(url) {
  const res = await requestPage(url, PAGE_TIMEOUT, 5, '', DOUBAO_HEADERS);
  if (res.status !== 200) {
    return { ok: false, error: '豆包对话页无响应，请稍后重试' };
  }
  const html = res.body.toString('utf8');
  const fallbackApis = extractFallbackApis(html);
  if (!fallbackApis.length) {
    return { ok: false, error: '对话页中未找到视频数据，请确认分享链接包含视频内容' };
  }
  let lastErr = '';
  for (const rawApi of fallbackApis) {
    const api = buildUnwatermarkedUrl(rawApi);
    if (!api) continue;
    try {
      const vRes = await requestPage(api, PAGE_TIMEOUT, 5, '', DOUBAO_HEADERS);
      if (vRes.status !== 200) {
        lastErr = `HTTP ${vRes.status}`;
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(vRes.body.toString('utf8'));
      } catch (e) {
        lastErr = '响应非 JSON';
        continue;
      }
      const videoInfo = payload.video_info || (payload.data && payload.data.video_info) || payload;
      const data = (videoInfo && typeof videoInfo === 'object' && videoInfo.data) || videoInfo;
      if (!data || typeof data !== 'object') {
        lastErr = '缺少视频数据';
        continue;
      }
      const rawList = data.video_list;
      const candidates = Array.isArray(rawList)
        ? rawList
        : rawList && typeof rawList === 'object'
          ? Object.values(rawList)
          : [data];
      const num = (v) => {
        const n = Number(v || 0);
        return Number.isFinite(n) ? n : 0;
      };
      const entries = candidates.filter(
        (it) => it && typeof it === 'object' && typeof (it.main_url || it.play_url) === 'string',
      );
      if (!entries.length) {
        lastErr = '响应中没有 main_url';
        continue;
      }
      entries.sort(
        (a, b) =>
          num(b.vwidth || b.width) * num(b.vheight || b.height) +
          num(b.bitrate || b.real_bitrate) -
          (num(a.vwidth || a.width) * num(a.vheight || a.height) + num(a.bitrate || a.real_bitrate)),
      );
      const entry = entries[0];
      const keySeed = String(
        data.key_seed || videoInfo.key_seed || payload.key_seed || '',
      );
      const videoUrl = decodeMainUrl(entry.main_url || entry.play_url, keySeed);
      if (!videoUrl) {
        lastErr = '视频直链解密失败';
        continue;
      }
      const title = String((payload.prompt || (payload.data && payload.data.prompt) || '')).slice(0, 80);
      const cover = String(data.poster_url || data.poster || payload.poster_url || '');
      return {
        ok: true,
        play: videoUrl,
        playNoMark: videoUrl,
        playFallbacks: entries
          .slice(1)
          .map((e2) => decodeMainUrl(e2.main_url || e2.play_url, keySeed))
          .filter((u2) => /^https?:\/\//.test(u2)),
        title,
        cover,
        note: '已取回豆包无水印原片',
        referer: '', // fplay 直链（douyinvod 系 CDN）带 Referer 有防盗链 403 风险，实测不带更稳
      };
    } catch (err) {
      lastErr = (err && err.message) || '请求异常';
    }
  }
  return { ok: false, error: `豆包无水印解析失败（${lastErr || '未知原因'}），可稍后重试` };
}

/* ---------------- 豆包无水印商业通道（api.xiaotuo.net，接口 194 /doubao） ----------------
 * 豆包 video-sharing 分享接口（游客态）仅返回水印流（lr=video_gen_watermark_dyn；
 * 页面上下文 + 全参数变体 + main/backup 双流均已穷举实测）。fplay 无水印接口需
 * 页面签发的鉴权参数（keystore），服务端无法裸调（403）。无水印直链由聚合 API
 * 提供（服务端持平台凭证池，即「耶斯去水印」等竞品小程序同款路线）。
 * 需在云函数环境变量配置 DOUBAO_API_KEY（api.xiaotuo.net 注册获取）；未配置自动跳过。
 */
function findXiaotuoVideo(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return null;
  const u = obj.url;
  if (typeof u === 'string' && /^https?:\/\//.test(u) && (u.includes('video/tos/') || u.includes('unwatermarked') || /\.mp4(\?|$)/i.test(u))) {
    return {
      url: u,
      title: typeof obj.title === 'string' ? obj.title : '',
      size: Number(obj.size) || 0,
    };
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const hit = findXiaotuoVideo(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
async function callDoubaoNoMarkApi(shareUrl) {
  const apiKey = String(process.env.DOUBAO_API_KEY || '').trim();
  if (!apiKey) return null;
  try {
    const res = await requestPostJson(
      'https://api.xiaotuo.net/api/v1/calls/invoke/doubao',
      { url: shareUrl },
      { 'x-api-key': apiKey },
    );
    if (res.status !== 200) return null;
    let j;
    try {
      j = JSON.parse(res.body);
    } catch (e) {
      return null;
    }
    return findXiaotuoVideo(j);
  } catch (err) {
    return null;
  }
}
/* ---------------- 通用聚合通道（video.zacao.top / api.xiaotuo.net）----------------
 * 【v13 开关控制，默认关闭】：自研直链链路验证期，zacao 暂不参与调用。
 * 验证通过后恢复方式：云开发控制台加环境变量 ZACAO_ENABLED=1（parseDoubao
 * 中该开关控制 callZacaoParse 最优先），无需改代码重新部署。
 * zacao 实测返回 lr=unwatermarked 原画流（21.6Mbps 原片码率，四角抽帧 LLM
 * 复核确认无水印）。免费体验额度（匿名 30 次/IP/小时，配 ZACAO_API_KEY 可
 * 扩容）；额度耗尽 / 失败时 callZacaoParse 返回 null 静默降级自研链路。
 * 失败形态实测：失效链接 HTTP 502 + succ:false（~2s 快速失败，不拖慢降级）。
 */
function extractZacaoVideo(j) {
  const d = j && j.data;
  if (!d || typeof d !== 'object') return null;
  const pick = (v) => (typeof v === 'string' && /^https?:\/\//.test(v) ? v : '');
  const url = pick(d.url) || pick(d.source_video_url);
  if (!url) return null;
  return {
    url,
    title: typeof d.title === 'string' ? d.title : '',
    cover: pick(d.cover_url) || pick(d.source_cover_url),
    size: Number(d.size) || 0,
  };
}

async function callZacaoParse(shareUrl) {
  const headers = {};
  const apiKey = String(process.env.ZACAO_API_KEY || '').trim();
  if (apiKey) headers['X-API-Key'] = apiKey;
  try {
    // 聚合解析耗时较长（实测 10~20s），超时放宽到 25s，避免慢响应被误判为失败
    const res = await requestPostJson('https://video.zacao.top/api/parse', { text: shareUrl }, headers, 25000);
    if (res.status !== 200) return null;
    let j;
    try {
      j = JSON.parse(res.body);
    } catch (e) {
      return null;
    }
    return extractZacaoVideo(j);
  } catch (err) {
    return null;
  }
}

/* 登录态播放信息：POST /samantha/video/get_play_info {"vid"}（需 DOUBAO_COOKIE）。
 * 响应 data.play_infos[] 的 main/backup 为各清晰度流；账号生成视频时开启
 * 「去除AI生成水印」开关的作品，登录态会直出 lr=unwatermarked 原画流。
 * 仅接受 lr=unwatermarked（其余与游客水印流相同，无意义）。 */
/** fplay 响应解析：video_list 按分辨率×码率择优 + key_seed 解密 main_url（parseDoubaoThread 同款） */
function pickFplayVideo(payload) {
  const videoInfo = payload.video_info || (payload.data && payload.data.video_info) || payload;
  const data = (videoInfo && typeof videoInfo === 'object' && videoInfo.data) || videoInfo;
  if (!data || typeof data !== 'object') return null;
  const rawList = data.video_list;
  const candidates = Array.isArray(rawList)
    ? rawList
    : rawList && typeof rawList === 'object'
      ? Object.values(rawList)
      : [data];
  const num = (v) => {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  };
  const entries = candidates.filter(
    (it) => it && typeof it === 'object' && typeof (it.main_url || it.play_url) === 'string',
  );
  if (!entries.length) return null;
  entries.sort(
    (a, b) =>
      num(b.vwidth || b.width) * num(b.vheight || b.height) +
      num(b.bitrate || b.real_bitrate) -
      (num(a.vwidth || a.width) * num(a.vheight || a.height) + num(a.bitrate || a.real_bitrate)),
  );
  const keySeed = String(
    data.key_seed || videoInfo.key_seed || payload.key_seed || '',
  );
  const url = decodeMainUrl(entries[0].main_url || entries[0].play_url, keySeed);
  if (!url) return null;
  return {
    url,
    fallbacks: entries.slice(1).map((e) => e.main_url || e.play_url).filter((x) => typeof x === 'string'),
    cover: String(data.poster_url || data.poster || payload.poster_url || ''),
  };
}

/** Cookie 池：DOUBAO_COOKIES（换行/分号分隔多账号）优先，单个 DOUBAO_COOKIE 兼容 */
function getDoubaoCookiePool() {
  const raw = String(process.env.DOUBAO_COOKIES || process.env.DOUBAO_COOKIE || '');
  return raw
    .split(/[\n;]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 10);
}

/** 轮询游标：随机初始化（多实例冷启动也均匀），每次解析递增取模，实现账号间均匀分摊 */
let doubaoCookieRR = Math.floor(Math.random() * 100000);

/** 从轮询起点重排 Cookie 池：起点账号优先，其后顺延（保留失效自动跳下一个的容错） */
function rotateCookiePool(cookies) {
  if (!cookies.length) return [];
  const start = doubaoCookieRR++ % cookies.length;
  return cookies.slice(start).concat(cookies.slice(0, start));
}

async function callDoubaoPlayInfo(vid) {
  if (!vid) return null;
  const cookies = rotateCookiePool(getDoubaoCookiePool());
  for (const cookie of cookies) {
    try {
      const res = await requestPostJson(
        'https://www.doubao.com/samantha/video/get_play_info',
        { vid },
        { Cookie: cookie, Referer: 'https://www.doubao.com/' },
      );
      if (res.status !== 200) continue;
      let j;
      try {
        j = JSON.parse(res.body);
      } catch (e) {
        continue;
      }
      if (!j || j.code !== 0 || !j.data || !Array.isArray(j.data.play_infos)) continue;
      const urls = [];
      for (const pi of j.data.play_infos) {
        if (pi && typeof pi.main === 'string' && pi.main) urls.push(pi.main);
        if (pi && typeof pi.backup === 'string' && pi.backup) urls.push(pi.backup);
      }
      // 1) 官方直出无水印流
      const hit = urls.find((x) => /lr=unwatermarked/.test(x));
      if (hit) return { url: hit, title: '', cover: '', size: 0 };
      // 2) fplay 形态 URL：改 logo_type=unwatermarked + codec_type=8 重放（doubao-nomark
      //    浏览器扩展同款手法——登录态页面播放器签发的 fplay 链接可改参重取转码模板）
      for (const u of urls) {
        const replay = buildUnwatermarkedUrl(u);
        if (!replay) continue;
        try {
          const vRes = await requestPage(replay, PAGE_TIMEOUT, 5, '', DOUBAO_HEADERS);
          if (vRes.status !== 200) continue;
          let payload;
          try {
            payload = JSON.parse(vRes.body.toString('utf8'));
          } catch (e) {
            continue;
          }
          const picked = pickFplayVideo(payload);
          if (picked && /lr=unwatermarked|video\/tos\//.test(picked.url)) {
            return { url: picked.url, title: '', cover: picked.cover, size: 0 };
          }
        } catch (err) {
          // 单条重放失败继续尝试下一条
        }
      }
    } catch (err) {
      // 当前 Cookie 失败（过期/风控），轮换下一个
    }
  }
  return null;
}

/* ---------------- 豆包消息通道（自研 Cookie 通道，v10） ----------------
 * video-sharing 分享接口（游客/登录态）只发水印流（穷举实测）；但作品生成
 * 消息（「你的视频生成好了」）在作者本人的豆包对话里，消息体 creation_block
 * 内嵌完整 video_model——含 fplay fallback_api（登录态签发、绑定 vid、
 * url_expire 到 2036 年长期有效）。链路（协议为抓包实测的 BDS JSON-over-HTTP）：
 *   1. POST /alice/conversation/list（query 必须带 aid 等公共参数）拿作者对话；
 *   2. POST /im/chain/single（cmd:3100，Content-Type 必须为
 *      `application/json; encoding=utf-8` + agw-js-conv: str 头）翻消息历史，
 *      anchor_index 从 int64 上限（最新）向前，翻页锚点取响应 next_index；
 *   3. 按 share 接口给出的 message_id 定位生成消息，取 video_model.fallback_api；
 *   4. fplay 改参重放（buildUnwatermarkedUrl 同款手法）→ qAAB 解密 → 无水印原画流。
 */
const DOUBAO_IM_QUERY =
  'version_code=20800&language=zh&device_platform=web&doubao_device_platform=web' +
  '&aid=497858&real_aid=497858&pkg_type=release_version&region=CN&sys_region=CN' +
  '&samantha_web=1&web_platform=browser&use-olympus-account=1';

function doubaoImHeaders(cookie) {
  return {
    'Content-Type': 'application/json; encoding=utf-8',
    'agw-js-conv': 'str',
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
    Origin: 'https://www.doubao.com',
    Referer: 'https://www.doubao.com/',
    'User-Agent': DOUBAO_DESKTOP_UA,
  };
}

/** 作者最近对话列表（去重，排除占位对话 id=0） */
async function fetchDoubaoConversations(cookie, limit = 6) {
  const list = [];
  try {
    const res = await requestPostJson(
      'https://www.doubao.com/alice/conversation/list?limit=30&last_fetch_time=0&last_id=&query_type=1&' +
        DOUBAO_IM_QUERY,
      { limit: 30, last_fetch_time: 0, last_id: '', query_type: 1 },
      doubaoImHeaders(cookie),
      10000,
    );
    if (res.status !== 200) return list;
    let j = null;
    try {
      j = JSON.parse(res.body);
    } catch (e) {
      return list;
    }
    const raw = j && j.data && Array.isArray(j.data.conversation_list) ? j.data.conversation_list : [];
    for (const c of raw) {
      const id = c ? String(c.conversation_id || '') : '';
      if (!id || id === '0' || list.some((x) => x.id === id)) continue;
      list.push({ id, name: String((c && c.name) || '') });
      if (list.length >= limit) break;
    }
  } catch (err) {
    // 列表失败返回已收集部分
  }
  return list;
}

/** 从「视频生成好了」消息体提取内嵌 fplay（video_model JSON 的 fallback_api） */
function extractFplayFromDoubaoMessage(msg) {
  const content = msg && typeof msg.content === 'string' ? msg.content : '';
  if (!content) return '';
  let blocks = null;
  try {
    blocks = JSON.parse(content);
  } catch (e) {
    return '';
  }
  if (!Array.isArray(blocks)) return '';
  for (const block of blocks) {
    const cb = block && block.content && block.content.creation_block;
    const creations = cb && Array.isArray(cb.creations) ? cb.creations : null;
    if (!creations) continue;
    for (const c of creations) {
      const video = c && c.video;
      const vmRaw = video && typeof video.video_model === 'string' ? video.video_model : '';
      if (!vmRaw) continue;
      let vm = null;
      try {
        vm = JSON.parse(vmRaw);
      } catch (e) {
        continue;
      }
      const api = vm && typeof vm.fallback_api === 'string' ? vm.fallback_api : '';
      if (api && /\/video\/fplay\//.test(api)) return api;
    }
  }
  return '';
}

/** 单对话内翻消息历史找目标 message_id，命中返回消息体内嵌 fplay */
async function findDoubaoVideoFplay(cookie, conversationId, messageId, maxPages = 4) {
  let anchor = 9007199254740991; // int64 上限 = 最新消息
  for (let page = 0; page < maxPages; page++) {
    let j = null;
    try {
      const res = await requestPostJson(
        'https://www.doubao.com/im/chain/single?' + DOUBAO_IM_QUERY,
        {
          cmd: 3100,
          uplink_body: {
            pull_singe_chain_uplink_body: {
              conversation_id: String(conversationId),
              anchor_index: anchor,
              conversation_type: 3,
              direction: 1,
              limit: 50,
              ext: {},
              filter: { index_list: [] },
              evaluate_ab_params: '',
              evaluate_common_params: '',
              option: { lazy_load_strategy: 0 },
            },
          },
          sequence_id: crypto.randomUUID(),
          channel: 2,
          version: '1',
        },
        doubaoImHeaders(cookie),
        15000,
      );
      if (res.status !== 200) return '';
      j = JSON.parse(res.body);
    } catch (err) {
      return '';
    }
    const dl =
      j && j.downlink_body && j.downlink_body.pull_singe_chain_downlink_body ? j.downlink_body.pull_singe_chain_downlink_body : null;
    const msgs = dl && Array.isArray(dl.messages) ? dl.messages : [];
    for (const m of msgs) {
      if (!m || String(m.message_id || '') !== String(messageId)) continue;
      const fplay = extractFplayFromDoubaoMessage(m);
      if (fplay) return fplay;
    }
    const next = dl && dl.next_index !== undefined && dl.next_index !== null ? String(dl.next_index) : '';
    const nextAnchor = Number(next);
    if (!dl || !dl.has_more || !next || !Number.isFinite(nextAnchor) || nextAnchor <= 0 || nextAnchor >= anchor) {
      return '';
    }
    anchor = nextAnchor;
  }
  return '';
}

/** 消息通道组合：Cookie 轮换 → 对话列表 → 逐对话翻页找生成消息 → fplay 改参重放取无水印流 */
async function callDoubaoMessageChannel(vid, messageId) {
  if (!vid || !messageId) return null;
  for (const cookie of rotateCookiePool(getDoubaoCookiePool())) {
    try {
      const convs = await fetchDoubaoConversations(cookie);
      for (const conv of convs) {
        const fplay = await findDoubaoVideoFplay(cookie, conv.id, messageId);
        if (!fplay || !fplay.includes(vid)) continue; // fplay token 服务端绑定 vid
        const api = buildUnwatermarkedUrl(fplay);
        if (!api) continue;
        const vRes = await requestPage(api, PAGE_TIMEOUT, 5, '', DOUBAO_HEADERS);
        if (vRes.status !== 200) continue;
        let payload = null;
        try {
          payload = JSON.parse(vRes.body.toString('utf8'));
        } catch (e) {
          continue;
        }
        const picked = pickFplayVideo(payload);
        if (picked && /lr=unwatermarked/.test(picked.url)) {
          return { url: picked.url, cover: picked.cover || '' };
        }
      }
    } catch (err) {
      // 当前 Cookie 失败（过期/风控），轮换下一个
    }
  }
  return null;
}

/** 豆包分享页 SSR 兜底：游客态分享页可能内嵌 fplay（与 thread 通道同款手法），
 * 命中即可改参重放取无水印转码；提取不到返回 null（不影响主链路）。 */
async function tryDoubaoShareSsr(shareUrl, vid) {
  try {
    const res = await requestPage(shareUrl, PAGE_TIMEOUT, 5, '', DOUBAO_HEADERS);
    if (res.status !== 200) return null;
    const html = res.body.toString('utf8');
    if (!html.includes('fallback_api')) return null;
    for (const rawApi of extractFallbackApis(html)) {
      if (vid && !rawApi.includes(vid)) continue;
      const api = buildUnwatermarkedUrl(rawApi);
      if (!api) continue;
      try {
        const vRes = await requestPage(api, PAGE_TIMEOUT, 5, '', DOUBAO_HEADERS);
        if (vRes.status !== 200) continue;
        let payload;
        try {
          payload = JSON.parse(vRes.body.toString('utf8'));
        } catch (e) {
          continue;
        }
        const picked = pickFplayVideo(payload);
        if (picked && /lr=unwatermarked/.test(picked.url)) {
          return { url: picked.url, cover: picked.cover || '' };
        }
      } catch (err) {
        // 单条失败继续尝试
      }
    }
  } catch (err) {
    // SSR 兜底失败静默降级
  }
  return null;
}

async function parseDoubao(url) {
  const u = new URL(url);
  const shareId = u.searchParams.get('share_id') || '';
  const vid = u.searchParams.get('video_id') || u.searchParams.get('vid') || '';
  if (!shareId || !vid) {
    return { ok: false, error: '豆包链接缺少分享参数，请使用 App 内「复制链接」获得的完整分享' };
  }
  // 聚合通道（zacao，v13 改为开关控制，默认关闭）：自研直链验证期，先跑
  // 「官方登录态 → 消息通道 → SSR」纯自研链路。验证通过后如需恢复 zacao 优先，
  // 云开发控制台加环境变量 ZACAO_ENABLED=1 即可（无需改代码重新部署）。
  // zacao 实测返回豆包官方 lr=unwatermarked 原画流；额度耗尽 / 失败（~2s 快速
  // 失败）时 callZacaoParse 返回 null，静默降级自研链路（下方原有流程不变）。
  if (process.env.ZACAO_ENABLED === '1') {
    const viaZacao = await callZacaoParse(url);
    if (viaZacao) {
      return {
        ok: true,
        play: viaZacao.url,
        playNoMark: viaZacao.url,
        title: String(viaZacao.title || '').slice(0, 80),
        cover: viaZacao.cover,
        size: viaZacao.size || 0,
        clientDownload: true,
        note: '已通过聚合通道取回无水印原片（手机端直下）',
        referer: '', // 豆包系匿名直链带 Referer 会触发防盗链 403，实测不带才能下载
      };
    }
  }
  // 自备凭证：DOUBAO_COOKIE（豆包网页端登录 Cookie）。账号开通「去除AI生成水印」
  // 后（专业版无品牌水印），官方分享接口在登录态下可能直接下发无水印流。
  const extraHeaders = {};
  const doubaoCookie = String(process.env.DOUBAO_COOKIE || '').trim();
  if (doubaoCookie) extraHeaders['Cookie'] = doubaoCookie;
  const res = await requestPostJson('https://www.doubao.com/creativity/share/get_video_share_info', {
    share_id: shareId,
    vid,
    creation_id: '',
  }, extraHeaders);
  let j = null;
  if (res.status === 200) {
    try {
      j = JSON.parse(res.body);
    } catch (e) {
      j = null;
    }
  }
  const play = j && j.code === 0 && j.data && j.data.play_info && j.data.play_info.main;
  if (!play) {
    // 官方分享接口失效（分享过期/风控/仅登录可见）时兜底：分享页 SSR 内嵌 fplay
    // 改参重放（自研无水印通道，游客态可用）。
    const ssr = await tryDoubaoShareSsr(url, vid);
    if (ssr) {
      return {
        ok: true,
        play: ssr.url,
        playNoMark: ssr.url,
        title: '',
        cover: ssr.cover,
        size: 0,
        clientDownload: true,
        note: '已通过分享页通道取回无水印原片（手机端直下）',
        referer: '', // 365yg 匿名直链带 Referer 会触发防盗链 403，实测不带才能下载
      };
    }
    return { ok: false, error: '豆包视频解析失败，请确认分享链接有效（作品可能已删除或分享已过期）' };
  }
  const backup = (j.data && j.data.play_info && j.data.play_info.backup) || '';
  const title = String((j.data && j.data.prompt) || '').slice(0, 80);
  const cover = (j.data && j.data.play_info && j.data.play_info.poster_url) || '';
  // 登录态直出无水印流：官方响应 URL 带 lr=unwatermarked 即为无水印原片
  const officialNoMark = [play, backup].find((x) => x && /lr=unwatermarked/.test(x)) || '';
  if (officialNoMark) {
    return {
      ok: true,
      play: officialNoMark,
      playFallbacks: backup && backup !== officialNoMark ? [backup, play] : [play],
      playNoMark: officialNoMark,
      title,
      cover,
      size: 0,
      clientDownload: true,
      note: '已通过登录态取回豆包无水印原片（手机端直下）',
      referer: '', // 365yg 匿名直链带 Referer 会触发防盗链 403，实测不带才能下载
    };
  }
  // 无水印链路（自研优先）：
  // 1) DOUBAO_COOKIE(S) 登录态 get_play_info——直出 lr=unwatermarked 原画流；或对
  //    fplay 形态 URL 改 logo_type=unwatermarked 重放（doubao-nomark 同款手法），
  //    未开「去除AI生成水印」开关的作品同样可取无水印转码，完全不依赖第三方；
  // 2) 消息通道：分享元数据 message_id → 作者对话翻页 → video_model 内嵌 fplay。
  // 命中任一通道即 clientDownload：AI 生成原片码率可达 22Mbps（27MB+），云函数
  // 下载+转存需 5~10s；fplay 直链 url_expire 到 2036 年长期有效，手机端直下
  // 把解析耗时压到 ~3s，也不再产生大体积临时文件（yt_cleanup 只需清封面小图）。
  const noMark = await callDoubaoPlayInfo(vid);
  if (noMark) {
    return {
      ok: true,
      play: noMark.url,
      playFallbacks: [play],
      playNoMark: noMark.url,
      title: noMark.title || title,
      cover: noMark.cover || cover,
      size: noMark.size || 0,
      clientDownload: true,
      note: '已通过你的豆包登录态取回无水印原片（手机端直下）',
      referer: '', // 同上
    };
  }
  // 2) 消息通道（v10 自研）：分享元数据带 message_id 时，去作者本人的豆包对话里
  //    翻出「视频生成好了」消息，从内嵌 video_model 的 fplay 改参重放取无水印原画流。
  //    实测该通道对 video-sharing 分享（官方接口仅发水印流的场景）有效。
  const sourceInfo = (j && j.data && j.data.source_info) || null;
  const messageId = sourceInfo ? String(sourceInfo.message_id || '') : '';
  if (messageId) {
    const viaMsg = await callDoubaoMessageChannel(vid, messageId);
    if (viaMsg) {
      return {
        ok: true,
        play: viaMsg.url,
        playFallbacks: [play],
        playNoMark: viaMsg.url,
        title,
        cover: viaMsg.cover || cover,
        size: 0,
        clientDownload: true,
        note: '已通过消息通道取回无水印原片（手机端直下）',
        referer: '',
      };
    }
  }
  const hasCookie = Boolean(
    String(process.env.DOUBAO_COOKIE || '').trim() ||
      String(process.env.DOUBAO_COOKIES || '')
        .split(/\r?\n|;/)
        .some((x) => x.trim().length > 8),
  );
  return {
    ok: true,
    play,
    playNoMark: '',
    title,
    cover,
    size: 0,
    clientDownload: true,
    note: hasCookie
      ? '登录态未能取到该作品无水印流（Cookie 可能过期或该作品官方仅存水印版）；已降级官方流（含水印）'
      : '未配置豆包登录态（DOUBAO_COOKIES），官方分享仅提供带水印流',
    referer: '', // 同上
  };
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
          note: '已取回可灵作品原片',
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
    note: '已取回即梦无水印原片',
    referer: 'https://jimeng.jianying.com/',
  };
}

/* ---------------- B站（bilibili.com / b23.tv，游客态公开 API） ----------------
 * B站视频本身无水印；分享多为 b23.tv 短链（302 → /video/BV 号页）。
 * 接口全游客态（无签名，机房 IP 实测可通，但 view 族接口对机房 IP 412 风控）：
 *   pagelist GET /x/player/pagelist?bvid= → cid + part（分P标题）+ first_frame
 *   playurl  GET /x/player/playurl?bvid=&cid=&platform=html5&high_quality=1
 *            → data.durl[0]（720P mp4 直链 + size + backup_url 兜底候选）
 * CDN 直链需带 UA（无 UA 403），downloadBuffer 默认 MOBILE_UA 满足。
 * CDN 域名变体多（bilivideo 系无法穷举进小程序 downloadFile 白名单）→ 走云函数
 * 转存模式（云存储域名固定可白名单）。
 * 健壮性：多分P按 ?p=N 取对应分P；qn 64→32→16 逐级降级；多段 durl 明确报错
 * 不静默截断；playurl 整体失败时由 mainHandler 下载段兜底 clientDownload。
 */
const BILI_HEADERS = { Referer: 'https://www.bilibili.com/' };

const BILI_ERROR_MAP = {
  '-400': 'B站链接格式不正确，或视频不存在 / 已被删除',
  '-404': '视频不存在或已被删除',
  '62002': '稿件不可见（可能审核中或已被锁定）',
  '62004': '视频审核未通过，无法取回',
  '62012': '仅 UP 主自己可见，无法取回',
};

/** av → BV：公开 base58 算法对 2024+ 新号段已失效，改走 302 → 移动版页面提取。
 * www.bilibili.com/video/avXXX 对移动 UA 返回 302 → m.bilibili.com 200 页面，
 * 页面内嵌真实 BV 号（canonical），实测稳定。 */
async function avToBvByPage(avid, page) {
  const res = await requestPage(`https://www.bilibili.com/video/av${avid}/`, PAGE_TIMEOUT, 5, '');
  const bv = (res.body ? res.body.toString('utf8') : '').match(/BV1[0-9a-zA-Z]{9}/);
  return bv ? { bvid: bv[0], page } : null;
}

/** 从任意 B站链接形态解析 BV 号与分P号；b23.tv 短链先跟随 302 展开。
 * 注意：BV 号 base58 编码大小写敏感，不可大写化。 */
async function resolveBiliTarget(url) {
  let u = url;
  if (/b23\.tv/i.test(u)) {
    const res = await requestPage(u, PAGE_TIMEOUT, 5, '');
    if (res.finalUrl && res.finalUrl !== url) u = res.finalUrl;
  }
  const pMatch = u.match(/[?&]p=(\d{1,3})(?:&|#|$)/);
  const page = pMatch ? Number(pMatch[1]) : 1;
  const bv = u.match(/[Bb][Vv]1[0-9a-zA-Z]{9}/);
  if (bv) return { bvid: bv[0], page };
  const av = u.match(/\/av(\d{5,15})/i);
  if (av) return avToBvByPage(av[1], page);
  return null;
}

async function parseBilibili(url) {
  const target = await resolveBiliTarget(url);
  if (!target) {
    return { ok: false, error: 'B站链接缺少视频 ID，请使用 App 内「复制链接」获得的完整分享' };
  }

  // 1) pagelist 取 cid 与分P信息（av 形态已转 BV；playurl 不认 aid）
  const idQuery = `bvid=${encodeURIComponent(target.bvid)}`;
  const plRes = await requestPage(
    `https://api.bilibili.com/x/player/pagelist?${idQuery}`,
    PAGE_TIMEOUT, 3, '', BILI_HEADERS,
  );
  if (plRes.status !== 200) {
    return { ok: false, error: `B站接口不可达（HTTP ${plRes.status}），请稍后重试` };
  }
  let pl = null;
  try {
    pl = JSON.parse(plRes.body.toString('utf8'));
  } catch (e) {
    pl = null;
  }
  if (!pl || typeof pl.code !== 'number') {
    return { ok: false, error: 'B站返回数据异常，请稍后重试' };
  }
  if (pl.code !== 0 || !Array.isArray(pl.data) || pl.data.length === 0) {
    const mapped = BILI_ERROR_MAP[String(pl.code)];
    return { ok: false, error: mapped || `B站视频取回失败（code ${pl.code}）` };
  }
  // 分P选择：?p=N 超界时回落第一P（部分分享链接会带过期的 p 参数）
  const seg0 = pl.data[0] || {};
  let pageItem = seg0;
  if (target.page > 1) {
    const hit = pl.data.find((it) => it && it.page === target.page);
    pageItem = hit || seg0;
  }
  const cid = pageItem.cid;
  if (!cid) return { ok: false, error: 'B站视频信息异常（缺少 cid），无法取回播放地址' };

  // 2) playurl 游客态 mp4 直链，qn 逐级降级（64=720P / 32=480P / 16=360P）
  let durl = null;
  let quality = 0;
  for (const qn of [64, 32, 16]) {
    try {
      const puRes = await requestPage(
        `https://api.bilibili.com/x/player/playurl?${idQuery}&cid=${encodeURIComponent(cid)}&qn=${qn}&platform=html5&high_quality=1`,
        PAGE_TIMEOUT, 3, '', BILI_HEADERS,
      );
      if (puRes.status !== 200) continue;
      let pu = null;
      try {
        pu = JSON.parse(puRes.body.toString('utf8'));
      } catch (e) {
        pu = null;
      }
      if (pu && pu.code === 0 && pu.data && Array.isArray(pu.data.durl) && pu.data.durl.length > 0) {
        durl = pu.data.durl;
        quality = pu.data.quality || qn;
        break;
      }
    } catch (e) {
      /* 尝试更低 qn */
    }
  }
  if (!durl) {
    return { ok: false, error: '未取到播放地址（可能为番剧 / 付费 / 互动视频，暂不支持）' };
  }
  if (durl.length > 1) {
    return { ok: false, error: `该视频时长过长（B站拆分为 ${durl.length} 段），暂不支持解析` };
  }
  const seg = durl[0] || {};
  if (!seg.url) return { ok: false, error: '播放地址为空，请稍后重试' };

  // backup_url 是同源备用 CDN，转存失败时由 mainHandler 逐候选重试
  const fallbacks = (Array.isArray(seg.backup_url) ? seg.backup_url : [])
    .filter((x) => /^https?:\/\//.test(String(x)))
    .slice(0, 3);
  const qualityLabel = { 64: '720P', 32: '480P', 16: '360P' }[quality] || `${quality}P`;

  // 标题：分P名（单P即主标题），多P带 P 标号；封面：首帧图（http 强转 https）
  const partTitle = String(pageItem.part || '').trim();
  const title = partTitle && pl.data.length > 1 ? `${partTitle}（P${pageItem.page || 1}）` : partTitle;
  const cover = String(pageItem.first_frame || '').replace(/^http:/, 'https:');

  return {
    ok: true,
    play: seg.url,
    playFallbacks: fallbacks,
    title: title.slice(0, 80),
    cover,
    size: Number(seg.size) > 0 ? Number(seg.size) : 0,
    note: `已取回 B站原视频（${qualityLabel}，游客公开接口画质上限）`,
    referer: 'https://www.bilibili.com/',
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

/** 转存封面到云存储（可选，失败不阻断——前端有无封面兜底样式）；返回 fileID 或空串 */
async function uploadCoverIfAny(parsed, openid) {
  if (!parsed.cover) return '';
  try {
    const coverBuf = await downloadBuffer(parsed.cover, 10000, 20 * 1024 * 1024, parsed.referer || '');
    if (coverBuf && coverBuf.length > 0) {
      const coverExt = extOf(parsed.cover, 'jpeg');
      const coverUpload = await cloud.uploadFile({
        cloudPath: resultPath(openid, coverExt),
        fileContent: coverBuf,
      });
      await register(coverUpload.fileID, openid);
      return coverUpload.fileID;
    }
  } catch (e) {
    console.warn('[video-parse] cover skipped:', e && e.message ? e.message : e);
  }
  return '';
}

async function mainHandler(event) {
  const text = String((event && event.text) || '')
    .trim()
    .slice(0, 2000);
  if (!text) return { ok: false, error: '请粘贴分享链接' };
  const url = extractUrl(text);
  if (!url) return { ok: false, error: '未识别到有效链接，请粘贴完整的分享内容' };

  let parsed;
  if (/\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(url)) {
    parsed = { ok: true, play: url, title: '', cover: '', note: '视频直链', referer: '' };
  } else if (/doubao\.com|dola\.com/i.test(url)) {
    try {
      // /thread/ 对话分享走无水印链路（fallback_api + 解密）；video-sharing 走分享接口（水印流兜底）
      parsed = /\/thread\//i.test(url) ? await parseDoubaoThread(url) : await parseDoubao(url);
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
  } else if (/bilibili\.com|b23\.tv/i.test(url)) {
    try {
      parsed = await parseBilibili(url);
    } catch (err) {
      return { ok: false, error: `B站解析失败：${err.message || '网络异常'}` };
    }
  } else if (/douyin\.com|iesdouyin\.com/i.test(url)) {
    try {
      parsed = await parseDouyin(url);
    } catch (err) {
      return { ok: false, error: `网络请求失败：${err.message || '未知错误'}` };
    }
  } else {
    return { ok: false, error: '当前支持抖音 / 豆包 / 可灵 / 即梦 / B站分享链接，更多平台陆续上线' };
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
    const coverFileID = await uploadCoverIfAny(parsed, openid);
    return {
      ok: true,
      clientDownload: true,
      play: parsed.play,
      playNoMark: parsed.playNoMark || '',
      // 透传多候选直链（share 页 url_list 变体 / play 接口 302 入口），
      // 手机端逐个尝试，避免单一直链失效（时效/防盗链）导致下载失败
      playFallbacks: Array.isArray(parsed.playFallbacks) ? parsed.playFallbacks.slice(0, 4) : [],
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
    // 云函数（机房 IP）下载被目标 CDN 风控：不再死报错，降级为客户端直下
    // （与抖音/豆包同架构——返回 play 直链，小程序端用用户网络下载）。
    const msg = (lastDlErr && lastDlErr.message) || '';
    console.error('[video-parse] download failed, fallback to clientDownload:', msg, '| candidates:', dlCandidates.length);
    if (msg.includes('200MB')) return { ok: false, error: msg };
    const coverFileID = await uploadCoverIfAny(parsed, openid);
    return {
      ok: true,
      clientDownload: true,
      play: parsed.playNoMark || dlCandidates[0],
      playNoMark: parsed.playNoMark || '',
      playFallbacks: dlCandidates.slice(1, 5),
      title: parsed.title || '',
      coverFileID,
      size: 0,
      note: '已取回视频源，保存时由手机网络直下',
      fallback: true,
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

/* 版本戳出口包装：任何返回（含失败）都带 ver，便于确认线上云函数版本 */
exports.main = async (event) => {
  const r = await mainHandler(event);
  return { ver: FN_VERSION, ...r };
};

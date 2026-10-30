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
 * 可灵/豆包/即梦的水印为生成时烧录进画面，取回原片仍带水印且小程序端
 * 无框选修复引擎，v1 暂不开放（返回友好提示），待云端 ffmpeg 方案落地后放开。
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
function requestPage(urlStr, timeoutMs = PAGE_TIMEOUT, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': MOBILE_UA, Referer: DOUYIN_REFERER },
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
          requestPage(next, timeoutMs, maxRedirects - 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, finalUrl: urlStr, body: Buffer.concat(chunks) }),
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
function downloadBuffer(urlStr, timeoutMs = DOWNLOAD_TIMEOUT, maxBytes = MAX_VIDEO_BYTES) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': MOBILE_UA, Referer: DOUYIN_REFERER },
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

/** 无水印地址：playwm 域名为水印流，play 域名为无水印流 */
function toNoWatermark(url) {
  return url.replace(/playwm/g, 'play').replace(/^http:\/\//, 'https://');
}

/** 从 share 页 HTML 解析视频数据（_ROUTER_DATA 或 RENDER_DATA） */
function extractFromHtml(html) {
  const routerMatch = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (routerMatch) {
    try {
      const data = JSON.parse(routerMatch[1]);
      const play = findPlayAddr(data) && findPlayAddr(data).url_list[0];
      if (play) {
        return {
          play: toNoWatermark(play),
          title: findStringField(data, ['desc', 'title']),
          cover: findStringField(data, ['cover', 'origin_cover']),
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
      const play = findPlayAddr(data) && findPlayAddr(data).url_list[0];
      if (play) {
        return {
          play: toNoWatermark(play),
          title: findStringField(data, ['desc', 'title']),
          cover: findStringField(data, ['cover', 'originCover', 'origin_cover']),
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

async function parseDouyin(url) {
  // 1. 跟随短链重定向，拿真实地址
  const page = await fetchPage(url);
  const awemeId = extractAwemeId(page.finalUrl) || extractAwemeId(url);
  if (!awemeId) {
    return { ok: false, error: '未能识别视频 ID，请确认分享链接完整' };
  }
  // 2. 依次尝试 share 页与主站页
  const pageUrls = [
    `https://www.iesdouyin.com/share/video/${awemeId}`,
    `https://www.douyin.com/video/${awemeId}`,
  ];
  for (const pageUrl of pageUrls) {
    try {
      const res = await fetchPage(pageUrl);
      const extracted = extractFromHtml(res.body.toString('utf8'));
      if (extracted) {
        return { ok: true, ...extracted, note: '已取回无水印原片' };
      }
    } catch (e) {
      /* 尝试下一个页面 */
    }
  }
  return { ok: false, error: '抖音页面解析失败（平台可能更新了接口），请稍后重试' };
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
    parsed = { ok: true, play: url, title: '', cover: '', note: '视频直链' };
  } else if (/douyin\.com|iesdouyin\.com/i.test(url)) {
    try {
      parsed = await parseDouyin(url);
    } catch (err) {
      return { ok: false, error: `网络请求失败：${err.message || '未知错误'}` };
    }
  } else {
    return { ok: false, error: '暂仅支持抖音分享链接，更多平台即将上线' };
  }
  if (!parsed.ok || !parsed.play) {
    return { ok: false, error: parsed.error || '解析失败，请检查链接' };
  }

  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID || 'guest';

  // 下载无水印视频并转存云存储
  let videoBuf;
  try {
    videoBuf = await downloadBuffer(parsed.play);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('超时')) return { ok: false, error: '视频下载超时，请重试' };
    if (msg.includes('200MB')) return { ok: false, error: msg };
    console.error('[video-parse] download failed:', msg);
    return { ok: false, error: '视频下载失败，请稍后重试' };
  }
  if (!videoBuf || videoBuf.length === 0) {
    return { ok: false, error: '视频源为空，请稍后重试' };
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
      const coverBuf = await downloadBuffer(parsed.cover, 10000, 20 * 1024 * 1024);
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

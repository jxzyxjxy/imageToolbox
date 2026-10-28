/**
 * 火山引擎方舟生图（OpenAI 兼容协议，原生 https 零依赖）。
 * 环境变量：ARK_API_KEY（必填）、ARK_BASE_URL（可选）、ARK_MODEL（可选覆盖模型）。
 */
const https = require('https');
const { URL } = require('url');

function requestJson(urlStr, headers, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = JSON.stringify(bodyObj);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(text) });
          } catch (e) {
            reject(new Error(`方舟接口返回异常（HTTP ${res.statusCode}）`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('方舟接口请求超时，请重试')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** 下载二进制（跟随 3xx 重定向，最多 3 次） */
function downloadBuffer(urlStr, timeoutMs, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.get(
      { hostname: u.hostname, path: u.pathname + u.search, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= 3) {
            reject(new Error('下载结果图重定向过多'));
            return;
          }
          resolve(downloadBuffer(res.headers.location, timeoutMs, redirects + 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`下载结果图失败（HTTP ${status}）`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('timeout', () => req.destroy(new Error('下载结果图超时')));
    req.on('error', reject);
  });
}

const ARK_MODEL_MAP = {
  seedream4: 'doubao-seedream-4-0-20260415',
  seedream5flash: 'doubao-seedream-5-0-flash-260915',
};

/** 调方舟生一张图并下载结果，返回结果图 Buffer */
async function generateOne({ prompt, imageDataUrl, size, modelKey }) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error('云函数未配置 ARK_API_KEY');
  const baseUrl = (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
  const model = process.env.ARK_MODEL || ARK_MODEL_MAP[modelKey] || ARK_MODEL_MAP.seedream4;

  const { status, json } = await requestJson(
    `${baseUrl}/images/generations`,
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      prompt,
      image: imageDataUrl,
      size,
      response_format: 'url',
      watermark: false,
    },
    50000,
  );
  if (status !== 200) {
    throw new Error((json.error && json.error.message) || `方舟接口返回 ${status}`);
  }
  const url = json.data && json.data[0] && json.data[0].url;
  if (!url) throw new Error('方舟接口未返回图片');
  return downloadBuffer(url, 20000);
}

module.exports = { generateOne, downloadBuffer };

/**
 * 火山引擎视觉智能 OpenAPI 调用（V4 签名，原生 https 零依赖）。
 * 用于人像分割 HumanSegment（证件照/智能抠图的主体分割）。
 *
 * 环境变量：
 *   VOLC_ACCESS_KEY / VOLC_SECRET_KEY  火山引擎主账号或 IAM 子账号 AK/SK（必填）
 *   VOLC_REGION                        默认 cn-north-1（火山视觉服务 region）
 *
 * 接口文档（人像抠图 HumanSegment，2020-08-26）：
 *   https://www.volcengine.com/docs/6318/66291
 *   https://www.volcengine.com/docs/86081/1804793
 * 开通入口：智能视觉控制台 https://console.volcengine.com/ai/overview
 *
 * 注意：该服务使用火山引擎访问控制(IAM)的 AK/SK，与方舟 ARK_API_KEY 是两套凭证。
 */
const crypto = require('crypto');
const https = require('https');

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacDigest(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

/** ISO8601 basic 格式：YYYYMMDDTHHMMSSZ */
function volcDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function post(host, path, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: host,
        path,
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
        res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('分割接口请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 人像分割：输入图片 base64，返回 { image?, mask? }（base64）。
 * image 为分割好的透明背景 PNG；仅返回 mask 时由调用方与原图合成。
 */
async function humanSegment(imageBase64) {
  const ak = process.env.VOLC_ACCESS_KEY;
  const sk = process.env.VOLC_SECRET_KEY;
  if (!ak || !sk) {
    const e = new Error('未配置火山引擎访问凭证（VOLC_ACCESS_KEY / VOLC_SECRET_KEY）');
    e.code = 'SEGMENT_UNAVAILABLE';
    throw e;
  }

  const host = 'visual.volcengineapi.com';
  const region = process.env.VOLC_REGION || 'cn-north-1';
  const service = 'cv';
  // 官方要求 application/x-www-form-urlencoded：
  // image_base64 纯 base64（不含 data: 前缀），return_foreground_image=1 直接返回透明 PNG
  const form = `image_base64=${encodeURIComponent(imageBase64)}&refine=1&return_foreground_image=1`;
  const payload = form;

  const now = new Date();
  const xDate = volcDate(now);
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const query = 'Action=HumanSegment&Version=2020-08-26';

  // 规范请求（签名头：content-type、host、x-content-sha256、x-date）
  const signedHeaderMap = {
    'content-type': 'application/x-www-form-urlencoded',
    host,
    'x-content-sha256': payloadHash,
    'x-date': xDate,
  };
  const headerKeys = Object.keys(signedHeaderMap).sort();
  const canonicalHeaders = headerKeys.map((k) => `${k}:${signedHeaderMap[k]}\n`).join('');
  const signedHeaders = headerKeys.join(';');
  const canonicalRequest = ['POST', '/', query, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmacDigest(sk, shortDate);
  const kRegion = hmacDigest(kDate, region);
  const kService = hmacDigest(kRegion, service);
  const kSigning = hmacDigest(kService, 'request');
  const signature = hmacHex(kSigning, stringToSign);

  const authorization =
    `HMAC-SHA256 Credential=${ak}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const { status, text } = await post(
    host,
    `/?${query}`,
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: authorization,
    },
    payload,
    30000,
  );

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const err = new Error(`分割接口返回异常（HTTP ${status}）`);
    err.code = 'SEGMENT_FAILED';
    throw err;
  }

  if (status !== 200 || json.code !== 10000) {
    const err = new Error(json.message || `分割接口错误（HTTP ${status}, code ${json.code}）`);
    err.code = 'SEGMENT_FAILED';
    console.error('[volc] HumanSegment 失败:', status, text.slice(0, 500));
    throw err;
  }

  const data = json.data || {};
  // foreground_image：透明背景前景 PNG（return_foreground_image=1 时返回）；mask 为兜底
  const result = {
    image: data.foreground_image || data.image || data.result || null,
    mask: data.mask || null,
  };
  if (!result.image && !result.mask) {
    console.error('[volc] HumanSegment 返回无图像数据:', JSON.stringify(Object.keys(data)));
    const err = new Error('分割接口未返回有效结果');
    err.code = 'SEGMENT_FAILED';
    throw err;
  }
  return result;
}

module.exports = { humanSegment };

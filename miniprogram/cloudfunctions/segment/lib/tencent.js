/**
 * 腾讯云·人体分析（BDA）人像分割 SegmentPortraitPic
 * 接口文档：https://cloud.tencent.com/document/product/1208/47002
 * 开通入口：腾讯云控制台搜索「人体分析」 https://console.cloud.tencent.com/bda
 * 签名：TC3-HMAC-SHA256（签名 v3，原生 crypto 实现，零依赖）
 *
 * 环境变量：
 *   TC_SECRET_ID   腾讯云 API 密钥 SecretId（https://console.cloud.tencent.com/cam/capi）
 *   TC_SECRET_KEY  腾讯云 API 密钥 SecretKey
 *   TC_BDA_REGION  地域，默认 ap-guangzhou
 */
const crypto = require('crypto');
const https = require('https');

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function post(host, headers, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: host,
        path: '/',
        headers: { 'Content-Length': Buffer.byteLength(payload), ...headers },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`分割接口返回 ${res.statusCode}：${text.slice(0, 300)}`));
            return;
          }
          resolve(text);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('分割接口请求超时')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * 人像分割（整像）。
 * @param {string} imageBase64 图片 base64（不含 data: 前缀，JPG/PNG，≤5MB）
 * @returns {Promise<{image: string|null, mask: string|null}>}
 *   image = 透明背景人像 PNG 的 base64（ResultImage），mask = 灰度 mask 兜底
 */
async function humanSegment(imageBase64) {
  const secretId = process.env.TC_SECRET_ID;
  const secretKey = process.env.TC_SECRET_KEY;
  if (!secretId || !secretKey) {
    const e = new Error('未配置腾讯云访问凭证（TC_SECRET_ID / TC_SECRET_KEY）');
    e.code = 'SEGMENT_UNAVAILABLE';
    throw e;
  }

  const host = 'bda.tencentcloudapi.com';
  const service = 'bda';
  const region = process.env.TC_BDA_REGION || 'ap-guangzhou';
  const action = 'SegmentPortraitPic';
  const version = '2020-03-24';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const payload = JSON.stringify({ ImageBase64: imageBase64 });

  // 1. 拼接规范请求串
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\n` +
    `host:${host}\n` +
    `x-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');

  // 2. 拼接待签名字符串
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // 3. 计算签名
  const kDate = hmacSha256(`TC3${secretKey}`, date);
  const kService = hmacSha256(kDate, service);
  const kSigning = hmacSha256(kService, 'tc3_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const text = await post(
    host,
    {
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Region': region,
      'X-TC-Timestamp': String(timestamp),
      Authorization: authorization,
    },
    payload,
    30000
  );

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const err = new Error(`分割接口返回非 JSON：${text.slice(0, 300)}`);
    err.code = 'SEGMENT_FAILED';
    throw err;
  }

  const resp = json.Response || {};
  if (resp.Error) {
    const err = new Error(
      `人像分割失败（${resp.Error.Code}）：${resp.Error.Message}`
    );
    err.code = 'SEGMENT_FAILED';
    throw err;
  }

  return {
    image: resp.ResultImage || null,
    mask: resp.ResultMask || null,
  };
}

module.exports = { humanSegment };

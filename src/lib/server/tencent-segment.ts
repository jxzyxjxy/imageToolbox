/**
 * 腾讯云·人体分析（BDA）人像分割 SegmentPortraitPic（服务端 Node 版）
 * 接口文档：https://cloud.tencent.com/document/product/1208/47002
 * 签名：TC3-HMAC-SHA256（原生 crypto 实现，零依赖）
 *
 * 环境变量：
 *   TC_SECRET_ID   腾讯云 API 密钥 SecretId（https://console.cloud.tencent.com/cam/capi）
 *   TC_SECRET_KEY  腾讯云 API 密钥 SecretKey
 *   TC_BDA_REGION  地域，默认 ap-guangzhou
 */
import crypto from 'crypto';
import https from 'https';

export class SegmentError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export function hasTencentCredentials(): boolean {
  return Boolean(process.env.TC_SECRET_ID && process.env.TC_SECRET_KEY);
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function post(
  host: string,
  headers: Record<string, string>,
  payload: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: host,
        path: '/',
        headers: { 'Content-Length': String(Buffer.byteLength(payload)), ...headers },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new SegmentError(`分割接口返回 ${res.statusCode}：${text.slice(0, 300)}`, 'SEGMENT_FAILED'));
            return;
          }
          resolve(text);
        });
      },
    );
    req.on('timeout', () => req.destroy(new SegmentError('分割接口请求超时', 'SEGMENT_TIMEOUT')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * 人像分割（整像）。
 * @param imageBase64 图片 base64（不含 data: 前缀，JPG/PNG，≤5MB，分辨率<2000x2000）
 * @returns 透明背景人像 PNG 的 Buffer（ResultImage）
 */
export async function segmentPortrait(imageBase64: string): Promise<Buffer> {
  const secretId = process.env.TC_SECRET_ID;
  const secretKey = process.env.TC_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new SegmentError('未配置腾讯云访问凭证（TC_SECRET_ID / TC_SECRET_KEY）', 'SEGMENT_UNAVAILABLE');
  }

  const host = 'bda.tencentcloudapi.com';
  const service = 'bda';
  const region = process.env.TC_BDA_REGION || 'ap-guangzhou';
  const action = 'SegmentPortraitPic';
  const version = '2020-03-24';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  // SegmentPortraitPic 入参（以官方 SDK 定义为准）：
  //   Image = 图片 base64（无 data: 前缀，≤5M，分辨率<2000x2000）
  //   RspImgType = base64 | Url；Scene = GEN 通用 / GS 绿幕
  const payload = JSON.stringify({
    Image: imageBase64,
    RspImgType: 'base64',
    Scene: 'GEN',
  });

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
    30000,
  );

  let json: { Response?: { ResultImage?: string; Error?: { Code: string; Message: string } } };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new SegmentError(`分割接口返回非 JSON：${text.slice(0, 300)}`, 'SEGMENT_FAILED');
  }

  const resp = json.Response || {};
  if (resp.Error) {
    throw new SegmentError(`人像分割失败（${resp.Error.Code}）：${resp.Error.Message}`, 'SEGMENT_FAILED');
  }
  if (!resp.ResultImage) {
    throw new SegmentError('分割接口未返回人像图（ResultImage 为空）', 'SEGMENT_FAILED');
  }

  return Buffer.from(resp.ResultImage, 'base64');
}

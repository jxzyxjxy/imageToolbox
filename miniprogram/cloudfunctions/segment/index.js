/**
 * AI 主体分割：证件照/智能抠图共用。
 * 通道选择：腾讯云人体分析（TC_SECRET_ID/TC_SECRET_KEY，推荐，每月 1000 次免费）
 *   优先；未配置时回落火山视觉智能（VOLC_ACCESS_KEY/VOLC_SECRET_KEY，老接口）。
 * event: { fileID }
 * 返回: { fileID, width, height, remaining, limit, provider, error?, code? }
 *   code = SEGMENT_UNAVAILABLE（未配置凭证）/ SEGMENT_FAILED（调用失败）→ 前端回落本地泛洪抠图
 */
const cloud = require('wx-server-sdk');
const { consume } = require('./lib/limit');
const storage = require('./lib/storage');
const tencent = require('./lib/tencent');
const volc = require('./lib/volc');
const pixels = require('./lib/pixels');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/** 选择可用的分割通道：腾讯云优先，火山兜底 */
function pickSegmentProvider() {
  if (process.env.TC_SECRET_ID && process.env.TC_SECRET_KEY) {
    return { name: 'tencent-bda', humanSegment: tencent.humanSegment };
  }
  if (process.env.VOLC_ACCESS_KEY && process.env.VOLC_SECRET_KEY) {
    return { name: 'volc-cv', humanSegment: volc.humanSegment };
  }
  return null;
}

/**
 * 只有 mask 时：腾讯 ResultMask 是 Float32 置信度文件（base64，非图片），
 * 每个浮点数对应源图（上送图）一个像素的人体置信度，按序覆盖整图。
 * 解码为灰度 alpha 后与源图合成。浮点量纲兼容 0~1 与 0~255 两种。
 */
async function applyFloatMask(srcImg, maskBase64) {
  const { width: w, height: h } = srcImg.bitmap;
  const buf = Buffer.from(maskBase64, 'base64');
  const floats = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  if (floats.length < w * h) {
    const e = new Error(`mask 尺寸不匹配（${floats.length} < ${w * h}）`);
    e.code = 'SEGMENT_FAILED';
    throw e;
  }
  let max = 0;
  for (let i = 0; i < w * h; i++) if (floats[i] > max) max = floats[i];
  const scale = max > 1.5 ? 1 : 255; // 0~255 量纲直接用；0~1 量纲乘 255
  const src = srcImg.bitmap.data;
  for (let i = 0; i < w * h; i++) {
    src[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(floats[i] * scale)));
  }
  return srcImg;
}

/** 分割结果与源图 alpha 取交集：源图本就透明的区域必须保持透明 */
async function intersectSourceAlpha(outImg, srcImg) {
  const { width: w, height: h } = outImg.bitmap;
  const srcAlpha = srcImg.clone().resize(w, h, pixels.Jimp.RESIZE_BILINEAR);
  const out = outImg.bitmap.data;
  const sa = srcAlpha.bitmap.data;
  let hasTransparentSource = false;
  for (let i = 0; i < w * h; i++) {
    const aSrc = sa[i * 4 + 3];
    if (aSrc < 250) {
      hasTransparentSource = true;
      const o = i * 4 + 3;
      out[o] = Math.min(out[o], aSrc);
    }
  }
  return hasTransparentSource ? outImg : outImg;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const fileID = event && event.fileID;
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    return { error: '缺少图片文件' };
  }

  // 通道选择（腾讯云优先，火山兜底；都未配置则返回不可用，前端回落本地抠图）
  const provider = pickSegmentProvider();
  if (!provider) {
    return {
      error: '未配置分割服务凭证（TC_SECRET_ID/TC_SECRET_KEY 或 VOLC_ACCESS_KEY/VOLC_SECRET_KEY）',
      code: 'SEGMENT_UNAVAILABLE',
    };
  }

  // 每日限频
  const db = cloud.database();
  const quota = await consume(db, OPENID, 'segment');
  if (!quota.ok) return { error: quota.error, code: 'LIMIT', remaining: 0, limit: quota.limit };

  try {
    const raw = await storage.download(cloud, fileID);
    // 限长边 1600（分割质量与成本平衡，与 H5 服务端一致）
    const srcImg = await pixels.readLimited(raw, 1600);
    const srcHasAlpha = pixels.hasTransparent(srcImg);

    // 分割 API 以 JPEG 上送（体积小；透明区转白，最后再做 alpha 交集修正）
    const flat = srcImg.clone().background(0xffffffff);
    const jpeg = await flat.quality(90).getBufferAsync(pixels.Jimp.MIME_JPEG);

    const seg = await provider.humanSegment(jpeg.toString('base64'));

    let outImg;
    if (seg.image) {
      outImg = await pixels.Jimp.read(Buffer.from(seg.image, 'base64'));
    } else if (seg.mask && seg.maskType === 'float32') {
      // 腾讯兜底：ResultMask 为 Float32 置信度文件（非图片），尺寸与上送图一致
      outImg = await applyFloatMask(flat.clone(), seg.mask);
    } else if (seg.mask) {
      // 火山兜底：mask 为灰度图片
      const maskImg = await pixels.Jimp.read(Buffer.from(seg.mask, 'base64'));
      maskImg.resize(flat.bitmap.width, flat.bitmap.height, pixels.Jimp.RESIZE_BILINEAR);
      outImg = flat.clone();
      const od = outImg.bitmap.data;
      const md = maskImg.bitmap.data;
      for (let i = 0; i < od.length / 4; i++) od[i * 4 + 3] = md[i * 4];
    } else {
      const e = new Error('分割服务未返回有效结果');
      e.code = 'SEGMENT_FAILED';
      throw e;
    }

    // 分割输出尺寸可能与输入不一致（模型侧缩放），统一回源图尺寸
    const sw = srcImg.bitmap.width;
    const sh = srcImg.bitmap.height;
    if (outImg.bitmap.width !== sw || outImg.bitmap.height !== sh) {
      outImg.resize(sw, sh, pixels.Jimp.RESIZE_BILINEAR);
    }

    if (srcHasAlpha) {
      outImg = await intersectSourceAlpha(outImg, srcImg);
    }

    const out = await outImg.getBufferAsync(pixels.Jimp.MIME_PNG);
    const resultFileID = await storage.upload(cloud, OPENID, out, 'png');
    return {
      fileID: resultFileID,
      width: sw,
      height: sh,
      provider: provider.name,
      remaining: quota.remaining,
      limit: quota.limit,
    };
  } catch (err) {
    console.error('[segment] 失败:', err);
    return {
      error: (err && err.message) || 'AI 抠图失败，请稍后重试',
      code: (err && err.code) || 'SEGMENT_FAILED',
    };
  }
};

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

/** 只有 mask（灰度图）时：把 mask 缩放到源图尺寸，作为 alpha 合成 */
function applyMask(srcImg, maskImg) {
  const { width: w, height: h } = srcImg.bitmap;
  maskImg.resize(w, h, pixels.Jimp.RESIZE_BILINEAR);
  const src = srcImg.bitmap.data;
  const mask = maskImg.bitmap.data;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    // mask 灰度（取 R 通道）作为透明度
    src[o + 3] = mask[o];
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
    } else {
      outImg = applyMask(srcImg.clone(), await pixels.Jimp.read(Buffer.from(seg.mask, 'base64')));
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

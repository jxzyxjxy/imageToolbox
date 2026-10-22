/**
 * 统一 AI 生图入口（方舟 Seedream，与 H5 服务端同 prompt/同模型）。
 * event: { tool, fileID, width?, height?, similarity?, count?, modelKey?, transparent? }
 *   tool: 'similar' 生成相似图 | 'watermark' 去水印 | 'object' 智能消除 | 'restore' 老照片修复
 * 图片一律走云存储中转（小程序 uploadFile → fileID），不受 callFunction 1MB 载荷限制。
 * 返回: { results: [{ fileID, width?, height? }], remaining, limit, size, format, error?, code? }
 */
const cloud = require('wx-server-sdk');
const { consume } = require('./lib/limit');
const storage = require('./lib/storage');
const { generateOne } = require('./lib/ark');
const pixels = require('./lib/pixels');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TOOLS = ['similar', 'watermark', 'object', 'restore'];

// 涂抹类 prompt：严格遵循 Seedream 官方「涂鸦编辑」范式——
// 用中文直接点名涂鸦颜色与动作，并强调其余区域像素级保持不变，避免模型把整图当图生图重画。
// 颜色须与 BrushCanvas 导出给 AI 的实色蒙版一致（去水印=橙 #f59e0b，智能消除=粉 #ec4899）。
const EDIT_PROMPTS = {
  watermark:
    '擦除图片中橙色涂抹位置覆盖的所有水印、文字、Logo 和印章，依据涂抹位置周围的纹理、颜色与光影自然填补修复，使这些区域看起来本来就没有任何东西。除橙色涂抹区域外，图片其他所有内容、构图、颜色、风格必须完全保持不变，禁止重新绘制或改动。真实自然、边缘无缝、无模糊、无编辑痕迹。',
  object:
    '擦除图片中粉色涂抹位置覆盖的多余物体或人物，依据粉色涂抹区域周围的背景纹理、颜色与光影自然填补，让被擦除的内容仿佛从未存在过。除粉色涂抹区域外，图片其他所有内容、构图、颜色、风格必须完全保持不变，禁止重新绘制或改动。真实自然、边缘无缝、无模糊、无编辑痕迹。',
  restore:
    'Restore this old, worn, blurred, noisy or damaged photograph into a sharp, clear, high-resolution image. Remove scratches, dust, spots, stains, grain, noise and faded areas; repair cracks, tears and creases; recover facial features and fine details with natural skin and material texture; correct contrast, brightness, white balance and slightly faded colors. Keep the original subject, pose, composition and identity unchanged. Photorealistic, natural, no over-processing, no plastic look, no artifacts.',
};

/** 方舟生图模型对输出尺寸的限制：各边 [720, 4096]，总像素至少 1280×720 */
const MIN_SIDE = 720;
const MAX_SIDE = 4096;
const MIN_AREA = 921600;

/** 归一化尺寸：保持宽高比，满足短边/面积下限，长边超限再等比缩小 */
function normalizeSize(w0, h0) {
  const k1 = MIN_SIDE / Math.min(w0, h0);
  const k2 = Math.sqrt(MIN_AREA / (w0 * h0));
  const k = Math.max(1, k1, k2);
  let w = Math.ceil(w0 * k);
  let h = Math.ceil(h0 * k);
  if (Math.max(w, h) > MAX_SIDE) {
    const kd = MAX_SIDE / Math.max(w, h);
    w = Math.floor(w * kd);
    h = Math.floor(h * kd);
    if (w < MIN_SIDE) w = MIN_SIDE;
    if (h < MIN_SIDE) h = MIN_SIDE;
    if (w * h < MIN_AREA) {
      if (w <= h) w = Math.ceil(MIN_AREA / h);
      else h = Math.ceil(MIN_AREA / w);
    }
  }
  return { w, h };
}

/** 根据相似度生成图生图引导词（与 H5 一致） */
function buildPrompt(similarity) {
  const base = '参考用户提供的图片进行图生图创作，输出高质量、细节丰富的图片。';
  if (similarity >= 80) {
    return (
      base +
      '生成的新图与原图高度相似：主体、构图、配色、风格与原图几乎保持一致，' +
      '仅在细节质感、光影与纹理上做轻微变化，让人一眼看出与原图是同一张的变体。'
    );
  }
  if (similarity >= 50) {
    return (
      base +
      '生成的新图与原图较为相似：保留主体、构图与整体风格，' +
      '适度改变细节、光影、色彩氛围与背景，与原图相似但又不完全一样。'
    );
  }
  return (
    base +
    '以原图为灵感自由创作：保留大致题材与风格方向，' +
    '重新演绎构图、细节与色彩，使新图与原图有明显差异但风格相近。'
  );
}

/** 图片内容安全检测（违规抛错；检测服务异常放行） */
async function secCheck(buffer) {
  try {
    const small = await pixels.toSecCheckBuffer(buffer);
    await cloud.openapi.security.imgSecCheck({
      media: { contentType: 'image/jpeg', value: small },
    });
  } catch (err) {
    if (err && err.errCode === 87014) {
      const e = new Error('图片包含违规内容，无法使用该功能');
      e.code = 'SEC_CHECK';
      throw e;
    }
    console.warn('[generate] 内容安全检测异常，已放行:', err && err.message);
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const tool = event && event.tool;
  if (!TOOLS.includes(tool)) return { error: '未知工具类型' };

  const fileID = event.fileID;
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    return { error: '缺少图片文件' };
  }

  // 1) 每日限频
  const db = cloud.database();
  const quota = await consume(db, OPENID, tool);
  if (!quota.ok) return { error: quota.error, code: 'LIMIT', remaining: 0, limit: quota.limit };

  try {
    // 2) 下载输入图 + 内容安全
    const raw = await storage.download(cloud, fileID);
    await secCheck(raw);

    // 3) 参考图（长边 ≤2048 JPEG data URL；透明区铺白底，避免 JPEG 黑底污染生成）
    const srcImg = await pixels.readLimited(raw, 2048);
    const srcHasAlpha = pixels.hasTransparent(srcImg);
    const imageDataUrl = await pixels.toReferenceDataUrl(srcImg);

    // 4) 尺寸与引导词
    const transparent = tool === 'similar' && event.transparent === true;
    let size = '2K';
    let prompt;
    let count = 1;
    if (tool === 'similar') {
      const w0 = Number(event.width);
      const h0 = Number(event.height);
      if (Number.isFinite(w0) && Number.isFinite(h0) && w0 > 0 && h0 > 0) {
        const { w, h } = normalizeSize(w0, h0);
        size = `${w}x${h}`;
      }
      const similarity = Math.min(100, Math.max(10, Math.round(Number(event.similarity) || 70)));
      count = Math.min(4, Math.max(1, Math.round(Number(event.count) || 1)));
      prompt = buildPrompt(similarity);
      if (transparent) {
        prompt +=
          '重要：将主体完整、居中地呈现在纯白色（#FFFFFF）背景上，' +
          '不要阴影、不要渐变、不要装饰元素、不要环境氛围渲染，' +
          '主体边缘清晰，背景必须是纯净均匀的白色。';
      }
    } else {
      prompt = EDIT_PROMPTS[tool];
    }

    // 5) 生图（多张并发，容忍部分失败）
    const settled = await Promise.all(
      Array.from({ length: count }, () =>
        generateOne({ prompt, imageDataUrl, size, modelKey: event.modelKey }).catch((e) => ({
          __error: e instanceof Error ? e.message : '生成失败',
        })),
      ),
    );
    const buffers = settled.filter((b) => !b.__error);
    if (buffers.length === 0) {
      const firstErr = settled[0] && settled[0].__error;
      return { error: firstErr || '生成失败，请重试' };
    }

    // 6) 结果后处理 + 全部上传云存储
    // - 相似图透明模式：抠白底输出 PNG
    // - 编辑类（消除/去水印/修复）：源图带透明区时做 alpha 交集，还原透明背景
    const keepAlpha = !transparent && tool !== 'similar' && srcHasAlpha;
    const results = [];
    for (const buf of buffers) {
      let out = buf;
      let ext = 'jpg';
      let width;
      let height;
      if (transparent) {
        try {
          const img = pixels.removeWhiteBackground(await pixels.readLimited(buf, 4096));
          out = await img.getBufferAsync(pixels.Jimp.MIME_PNG);
          width = img.bitmap.width;
          height = img.bitmap.height;
          ext = 'png';
        } catch (e) {
          console.warn('[generate] 透明抠图失败，退回原图:', e && e.message);
        }
      } else if (keepAlpha) {
        try {
          const img = await pixels.readLimited(buf, 4096);
          pixels.intersectAlpha(img, srcImg);
          out = await img.getBufferAsync(pixels.Jimp.MIME_PNG);
          width = img.bitmap.width;
          height = img.bitmap.height;
          ext = 'png';
        } catch (e) {
          console.warn('[generate] 透明区还原失败，退回原图:', e && e.message);
        }
      }
      const id = await storage.upload(cloud, OPENID, out, ext);
      results.push({ fileID: id, width, height });
    }

    return {
      results,
      remaining: quota.remaining,
      limit: quota.limit,
      size,
      format: transparent || keepAlpha ? 'png' : 'jpg',
    };
  } catch (err) {
    console.error('[generate] 失败:', err);
    return {
      error: (err && err.message) || '生成失败，请重试',
      code: (err && err.code) || undefined,
    };
  }
};

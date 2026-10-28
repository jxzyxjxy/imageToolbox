/**
 * AI 工具共享处理逻辑：/api/*（H5 站点）与 /api/mp/*（微信小程序）共用。
 * 差异只在入口鉴权：H5 直接放行，小程序必须携带云函数签发的票据。
 */
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { removeBackground } from '@imgly/background-removal-node';
import { resolveReferenceImageUrl } from '@/lib/server/reference-image';
import { generateImages, ARK_MODEL_KEYS, type ArkModelKey } from '@/lib/server/image-gen';
import { removeWhiteBackground } from '@/lib/server/remove-bg';
import { hasTencentCredentials, segmentPortrait } from '@/lib/server/tencent-segment';

/* ---------- 共享小工具 ---------- */

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) {
    throw new Error('图片数据格式不正确');
  }
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/* ---------- 生成相似图 ---------- */

export interface SimilarBody {
  imageBase64?: string;
  width?: number;
  height?: number;
  similarity?: number;
  count?: number;
  modelKey?: string;
  transparent?: boolean;
}

/** 方舟生图模型对输出尺寸的限制：各边 [720, 4096]，总像素至少 921600（1280×720） */
const MIN_SIDE = 720;
const MAX_SIDE = 4096;
const MIN_AREA = 921600;

/** 归一化尺寸：全程保持宽高比，满足短边/面积下限，长边超限再等比缩小 */
function normalizeSize(w0: number, h0: number): { w: number; h: number } {
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

/** 根据相似度生成图生图引导词 */
function buildPrompt(similarity: number): string {
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

export async function handleSimilar(
  body: SimilarBody,
  forwardHeaders: Record<string, string>,
): Promise<NextResponse> {
  try {
    const { imageBase64 } = body;
    const similarity = Math.min(100, Math.max(10, Math.round(body.similarity ?? 70)));
    const count = Math.min(4, Math.max(1, Math.round(body.count ?? 1)));

    if (!imageBase64) {
      return NextResponse.json({ error: '缺少图片数据' }, { status: 400 });
    }

    const hasCustomSize =
      typeof body.width === 'number' &&
      typeof body.height === 'number' &&
      Number.isFinite(body.width) &&
      Number.isFinite(body.height) &&
      body.width > 0 &&
      body.height > 0;
    const size = hasCustomSize
      ? (() => {
          const { w, h } = normalizeSize(body.width as number, body.height as number);
          return `${w}x${h}`;
        })()
      : '2K';

    const { mime, buffer } = parseDataUrl(imageBase64);
    const ext = extFromMime(mime);

    const imageUrl = await resolveReferenceImageUrl({
      buffer,
      mime,
      ext,
      keyPrefix: 'similar',
    });

    const transparent = body.transparent === true;
    let prompt = buildPrompt(similarity);
    if (transparent) {
      prompt +=
        '重要：将主体完整、居中地呈现在纯白色（#FFFFFF）背景上，' +
        '不要阴影、不要渐变、不要装饰元素、不要环境氛围渲染，' +
        '主体边缘清晰，背景必须是纯净均匀的白色。';
    }

    const modelKey: ArkModelKey = (ARK_MODEL_KEYS as string[]).includes(body.modelKey ?? '')
      ? (body.modelKey as ArkModelKey)
      : 'seedream4';

    try {
      const imageUrls = await generateImages({
        prompt,
        imageUrl,
        size,
        watermark: false,
        count,
        modelKey,
        forwardHeaders,
      });

      if (transparent) {
        const processed: string[] = [];
        for (const u of imageUrls) {
          const res = await fetch(u);
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          const png = await removeWhiteBackground(buf);
          processed.push(`data:image/png;base64,${png.toString('base64')}`);
        }
        if (processed.length === 0) {
          return NextResponse.json({ error: '透明背景处理失败，请重试' }, { status: 502 });
        }
        return NextResponse.json({
          imageUrls: processed,
          similarity,
          size,
          modelKey,
          format: 'png',
        });
      }

      return NextResponse.json({ imageUrls, similarity, size, modelKey });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '相似图生成失败，请重试';
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ---------- 图像编辑（去水印/消除/修复） ---------- */

export type EditMode = 'watermark' | 'object' | 'restore';

const EDIT_PROMPTS: Record<EditMode, string> = {
  watermark:
    '擦除图片中橙色涂抹位置覆盖的所有水印、文字、Logo和印章，依据周围纹理、颜色与光照自然填补还原该区域。除橙色涂抹区域外，图片其他部分完全保持不变，禁止重新绘制或改动。真实自然，无模糊，无修图痕迹。',
  object:
    '擦除图片中粉色涂抹位置覆盖的多余物体或人物，用与周围匹配的背景、纹理和光照无缝填补该区域，使其看起来从未存在过。除粉色涂抹区域外，图片其他部分完全保持不变，禁止重新绘制或改动。真实自然，无模糊，无修图痕迹。',
  restore:
    'Restore this old, worn, blurred, noisy or damaged photograph into a sharp, clear, high-resolution image. Remove scratches, dust, spots, stains, grain, noise and faded areas; repair cracks, tears and creases; recover facial features and fine details with natural skin and material texture; correct contrast, brightness, white balance and slightly faded colors. Keep the original subject, pose, composition and identity unchanged. Photorealistic, natural, no over-processing, no plastic look, no artifacts.',
};

export async function handleImageEdit(
  body: { imageBase64?: string; mode?: EditMode },
  forwardHeaders: Record<string, string>,
): Promise<NextResponse> {
  try {
    const { imageBase64, mode = 'watermark' } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: '缺少图片数据' }, { status: 400 });
    }

    const { mime, buffer } = parseDataUrl(imageBase64);
    const ext = extFromMime(mime);

    // 源图含真实透明像素时，生成完成后需把对应区域还原透明（输出 PNG）
    const resizedSource = await sharp(buffer)
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .png()
      .toBuffer();
    const srcStats = await sharp(resizedSource).stats();
    const srcTransparent = (srcStats.channels[3]?.min ?? 255) < 250;

    const imageUrl = await resolveReferenceImageUrl({
      buffer,
      mime,
      ext,
      keyPrefix: 'image-edit',
    });

    try {
      const imageUrls = await generateImages({
        prompt: EDIT_PROMPTS[mode],
        imageUrl,
        size: '2K',
        watermark: false,
        count: 1,
        forwardHeaders,
      });

      if (srcTransparent) {
        const res = await fetch(imageUrls[0]);
        if (!res.ok) {
          return NextResponse.json({ error: '结果图下载失败，请重试' }, { status: 502 });
        }
        const resultBuf = Buffer.from(await res.arrayBuffer());
        const merged = await intersectSourceAlpha(resultBuf, resizedSource);
        return NextResponse.json({
          imageUrl: `data:image/png;base64,${merged.toString('base64')}`,
        });
      }
      return NextResponse.json({ imageUrl: imageUrls[0] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 处理失败，请重试';
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ---------- AI 主体分割（ISNet 本地推理，零外部调用费用） ---------- */

/**
 * 原图 alpha 与 AI 分割结果取交集：
 * 原图本就透明的区域（透明 PNG 素材）必须保持透明，不允许模型补出黑色/其他背景。
 */
async function intersectSourceAlpha(segmented: Buffer, resizedSource: Buffer): Promise<Buffer> {
  const base = sharp(segmented).ensureAlpha();
  const meta = await base.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return segmented;

  const seg = await base.raw().toBuffer();
  const srcAlpha = await sharp(resizedSource)
    .ensureAlpha()
    .resize(w, h, { fit: 'fill' })
    .extractChannel(3)
    .raw()
    .toBuffer();

  let hasTransparentSource = false;
  for (let i = 0; i < w * h; i++) {
    const aSrc = srcAlpha[i];
    if (aSrc < 250) {
      hasTransparentSource = true;
      seg[i * 4 + 3] = Math.min(seg[i * 4 + 3], aSrc);
    }
  }
  if (!hasTransparentSource) return segmented;
  return sharp(seg, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** imgly 本地分割兜底（海外 CDN 模型下载可能极慢，限时等待，超时视为不可用） */
async function removeBackgroundLocal(input: Blob): Promise<Blob> {
  const LOCAL_TIMEOUT_MS = 45_000;
  return Promise.race([
    removeBackground(input),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('本地抠图模型超时')), LOCAL_TIMEOUT_MS),
    ),
  ]);
}

export async function handleSegment(body: { imageBase64?: string }): Promise<NextResponse> {
  try {
    const parsed = parseDataUrlSafe(body.imageBase64);
    if (!parsed) {
      return NextResponse.json({ error: '无效的图像数据' }, { status: 400 });
    }

    // PNG 保留 alpha（透明素材），其它格式转 JPEG 减小送入模型的体积
    const isPng = parsed.mime === 'image/png';
    const resized = await sharp(parsed.buffer)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true });
    const modelInput = isPng
      ? await resized.png().toBuffer()
      : await resized.jpeg({ quality: 90 }).toBuffer();

    let outBuf: Buffer;
    if (hasTencentCredentials()) {
      // 优先：腾讯云人像分割（稳定、快、效果好）。API 限制 base64 ≤5MB，超限转 JPEG
      let apiInput = modelInput;
      let apiIsPng = isPng;
      if (apiInput.length > 4.5 * 1024 * 1024) {
        apiInput = await sharp(modelInput).jpeg({ quality: 88 }).toBuffer();
        apiIsPng = false;
      }
      outBuf = await segmentPortrait(apiInput.toString('base64'));
      // 透明 PNG 素材：源 alpha 与分割结果求交，保留源图镂空细节
      if (apiIsPng) {
        outBuf = await intersectSourceAlpha(outBuf, modelInput);
      }
    } else {
      // 无腾讯凭证：回落本地 imgly 模型（需下载模型文件，可能较慢）
      const blob = await removeBackgroundLocal(
        new Blob([new Uint8Array(modelInput)], { type: isPng ? 'image/png' : 'image/jpeg' }),
      );
      outBuf = Buffer.from(await blob.arrayBuffer());
      if (isPng) {
        outBuf = await intersectSourceAlpha(outBuf, modelInput);
      }
    }

    return NextResponse.json({
      dataUrl: `data:image/png;base64,${outBuf.toString('base64')}`,
    });
  } catch (error) {
    console.error('[segment] AI 分割失败:', error);
    return NextResponse.json({ error: 'AI 抠图失败，请稍后重试' }, { status: 500 });
  }
}

function parseDataUrlSafe(dataUrl?: string): { mime: string; buffer: Buffer } | null {
  if (!dataUrl) return null;
  const match = /^data:(image\/[\w+.-]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

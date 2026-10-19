import { NextRequest, NextResponse } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { resolveReferenceImageUrl } from '@/lib/server/reference-image';
import { generateImages, ARK_MODEL_KEYS, type ArkModelKey } from '@/lib/server/image-gen';

export const runtime = 'nodejs';

interface SimilarBody {
  imageBase64?: string;
  /** 输出尺寸预设：auto | square | portrait34 | landscape43 | portrait916 | landscape169 */
  sizePreset?: string;
  /** 相似度 10~100，越高越贴近原图 */
  similarity?: number;
  /** 生成张数 1~4 */
  count?: number;
  /** 生图模型：seedream4 | seedream5flash */
  modelKey?: string;
}

const SIZE_MAP: Record<string, string> = {
  auto: '2K',
  square: '2880x2880',
  portrait34: '2880x3840',
  landscape43: '3840x2880',
  portrait916: '2304x4096',
  landscape169: '4096x2304',
};

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

export async function POST(request: NextRequest) {
  try {
    const body: SimilarBody = await request.json();
    const { imageBase64, sizePreset = 'auto' } = body;
    const similarity = Math.min(100, Math.max(10, Math.round(body.similarity ?? 70)));
    const count = Math.min(4, Math.max(1, Math.round(body.count ?? 1)));

    if (!imageBase64) {
      return NextResponse.json({ error: '缺少图片数据' }, { status: 400 });
    }

    const { mime, buffer } = parseDataUrl(imageBase64);
    const ext = extFromMime(mime);
    const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);

    // 1. 准备参考图 URL：沙箱走对象存储签名 URL，自托管走 data URL
    const imageUrl = await resolveReferenceImageUrl({
      buffer,
      mime,
      ext,
      keyPrefix: 'similar',
    });

    // 2. 图生图：相似度 -> 提示词强度，尺寸 -> 合法预设，张数 -> 批量并行
    //    自托管配置 ARK_API_KEY 时走火山方舟，否则走 Coze 集成网关
    const prompt = buildPrompt(similarity);
    const size = SIZE_MAP[sizePreset] ?? '2K';

    const modelKey: ArkModelKey = (ARK_MODEL_KEYS as string[]).includes(
      body.modelKey ?? '',
    )
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

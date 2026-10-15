import { NextRequest, NextResponse } from 'next/server';
import {
  ImageGenerationClient,
  Config,
  HeaderUtils,
  S3Storage,
} from 'coze-coding-dev-sdk';

export const runtime = 'nodejs';

interface SimilarBody {
  imageBase64?: string;
  /** 输出尺寸预设：auto | square | portrait34 | landscape43 | portrait916 | landscape169 */
  sizePreset?: string;
  /** 相似度 10~100，越高越贴近原图 */
  similarity?: number;
  /** 生成张数 1~4 */
  count?: number;
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

    // 1. 上传参考图到对象存储，取得图生图可访问的 URL
    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: '',
      secretKey: '',
      bucketName: process.env.COZE_BUCKET_NAME,
      region: 'cn-beijing',
    });
    const key = await storage.uploadFile({
      fileContent: buffer,
      fileName: `similar/source_${Date.now()}.${ext}`,
      contentType: mime,
    });
    const imageUrl = await storage.generatePresignedUrl({ key, expireTime: 3600 });

    // 2. 图生图：相似度 -> 提示词强度，尺寸 -> 合法预设，张数 -> 批量并行
    const config = new Config();
    const client = new ImageGenerationClient(config, forwardHeaders);
    const prompt = buildPrompt(similarity);
    const size = SIZE_MAP[sizePreset] ?? '2K';

    const requests = Array.from({ length: count }, () => ({
      prompt,
      image: imageUrl,
      size,
      watermark: false,
    }));
    const responses = await client.batchGenerate(requests);

    const imageUrls: string[] = [];
    const errors: string[] = [];
    for (const res of responses) {
      const helper = client.getResponseHelper(res);
      if (helper.success && helper.imageUrls.length > 0) {
        imageUrls.push(helper.imageUrls[0]);
      } else {
        errors.push(...helper.errorMessages);
      }
    }

    if (imageUrls.length === 0) {
      return NextResponse.json(
        { error: errors[0] || '相似图生成失败，请重试' },
        { status: 502 },
      );
    }

    return NextResponse.json({ imageUrls, similarity, size });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

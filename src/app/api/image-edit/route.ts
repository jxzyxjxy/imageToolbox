import { NextRequest, NextResponse } from 'next/server';
import {
  ImageGenerationClient,
  Config,
  HeaderUtils,
} from 'coze-coding-dev-sdk';
import { resolveReferenceImageUrl } from '@/lib/server/reference-image';

export const runtime = 'nodejs';

type EditMode = 'watermark' | 'object' | 'restore';

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

const PROMPTS: Record<EditMode, string> = {
  watermark:
    'Remove all watermarks, overlaid text, logos and stamps from this image, especially in the areas highlighted by the user brush mask. Naturally reconstruct and fill those regions using the surrounding texture, colors and lighting. Keep every other part of the image exactly unchanged. Photorealistic, seamless, high-quality image retouching, no blur, no traces of editing.',
  object:
    'Remove the unwanted objects or people highlighted by the user brush mask from this photo. Seamlessly fill the erased regions with the matching surrounding background, texture and lighting so they look as if they never existed. Keep every other part of the image exactly unchanged. Photorealistic, seamless, high-quality inpainting, no blur, no traces of editing.',
  restore:
    'Restore this old, worn, blurred, noisy or damaged photograph into a sharp, clear, high-resolution image. Remove scratches, dust, spots, stains, grain, noise and faded areas; repair cracks, tears and creases; recover facial features and fine details with natural skin and material texture; correct contrast, brightness, white balance and slightly faded colors. Keep the original subject, pose, composition and identity unchanged. Photorealistic, natural, no over-processing, no plastic look, no artifacts.',
};

export async function POST(request: NextRequest) {
  try {
    const body: { imageBase64?: string; mode?: EditMode } = await request.json();
    const { imageBase64, mode = 'watermark' } = body;

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
      keyPrefix: 'image-edit',
    });

    // 2. 调用 AI 图生图，按模式语义修复
    const config = new Config();
    const client = new ImageGenerationClient(config, forwardHeaders);
    const response = await client.generate({
      prompt: PROMPTS[mode],
      image: imageUrl,
      size: '2K',
      watermark: false,
    });

    const helper = client.getResponseHelper(response);
    if (!helper.success || helper.imageUrls.length === 0) {
      return NextResponse.json(
        { error: helper.errorMessages.join('；') || 'AI 处理失败，请重试' },
        { status: 502 },
      );
    }

    return NextResponse.json({ imageUrl: helper.imageUrls[0] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '服务器内部错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { removeBackground } from '@imgly/background-removal-node';

// AI 人像/主体分割（ISNet，本地推理，不产生外部 API 费用）
// 输入 dataURL → 输出透明背景 PNG dataURL

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { imageBase64?: string };
    const m = /^data:image\/[\w+.-]+;base64,(.+)$/.exec(body.imageBase64 || '');
    if (!m) {
      return NextResponse.json({ error: '无效的图像数据' }, { status: 400 });
    }

    const input = Buffer.from(m[1], 'base64');

    // 限长边 1600：分割模型内部输入远小于此，过大只会拖慢推理
    const resized = await sharp(input)
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();

    const blob = await removeBackground(
      new Blob([new Uint8Array(resized)], { type: 'image/png' }),
    );
    const outBuf = Buffer.from(await blob.arrayBuffer());

    return NextResponse.json({
      dataUrl: `data:image/png;base64,${outBuf.toString('base64')}`,
    });
  } catch (error) {
    console.error('[segment] AI 分割失败:', error);
    return NextResponse.json({ error: 'AI 抠图失败，请稍后重试' }, { status: 500 });
  }
}

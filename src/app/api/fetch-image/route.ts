import { NextResponse } from 'next/server';

const MAX_BYTES = 16 * 1024 * 1024; // 16MB 上限保护

/**
 * 服务端代理：把第三方(签名/跨域)图片 URL 拉取为本地 dataURL，
 * 供前端预览与下载，规避浏览器跨域与防盗链限制。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url: unknown = body?.url;
    if (typeof url !== 'string') {
      return NextResponse.json({ error: '图片地址无效' }, { status: 400 });
    }
    // 已是 dataURL（如透明 PNG 消除结果）时直接透传，无需再代理
    if (url.startsWith('data:image/')) {
      return NextResponse.json({ dataUrl: url });
    }
    if (!/^https?:\/\//.test(url)) {
      return NextResponse.json({ error: '图片地址无效' }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'image/*' },
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      return NextResponse.json({ error: `上游图片获取失败(${res.status})` }, { status: 502 });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: '图片体积过大（>16MB）' }, { status: 413 });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const base64 = buf.toString('base64');
    return NextResponse.json({ dataUrl: `data:${contentType};base64,${base64}` });
  } catch {
    return NextResponse.json({ error: '图片获取失败，请重试' }, { status: 502 });
  }
}
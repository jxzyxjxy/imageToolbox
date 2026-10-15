import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import sharp from 'sharp';

interface IconBox {
  name?: string;
  box?: number[];
}

interface SplitItem {
  name: string;
  dataUrl: string;
  w: number;
  h: number;
}

/**
 * 图标拆分：AI 定位每个独立图标的边界框，再用 sharp 按框裁剪出透明 PNG。
 * Body: { imageBase64: "data:image/png;base64,..." }
 * 返回: { items: [{ name, dataUrl, w, h }] }
 */
export async function POST(request: NextRequest) {
  try {
    const { imageBase64 } = await request.json();
    if (typeof imageBase64 !== 'string' || !imageBase64.startsWith('data:image')) {
      return NextResponse.json({ error: '无效的图片数据' }, { status: 400 });
    }

    const buf = Buffer.from(imageBase64.split(',')[1], 'base64');
    const meta = await sharp(buf).metadata();
    const W = meta.width || 0;
    const H = meta.height || 0;
    if (!W || !H) {
      return NextResponse.json({ error: '无法读取图片尺寸' }, { status: 400 });
    }

    // 1) AI 视觉定位每个图标
    let boxes: IconBox[] = [];
    try {
      const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
      const config = new Config();
      const client = new LLMClient(config, customHeaders);

      const prompt = [
        '分析这张图片，找出其中所有独立展示的图标或元素（例如图标拼合图、工具栏、贴纸、按钮、logo 组、表情等，每个独立图形算一个）。',
        '要求：逐图标给出边界框，不要合并、不要只框出其中一两个；即使图标边缘有间距、网格线或装饰背景，也要把每一个独立图标单独框出来。',
        '忽略作为背景的填色区、网格线或大面积装饰底。',
        '每个图标用归一化坐标 box:[x1,y1,x2,y2] 表示其外接矩形：x、y 取值 0~1，坐标原点在左上角，向右为 x 增大、向下为 y 增大。若图片非常小或确实只有一个图形，则返回仅一个框。',
        'name 用简洁的中文或英文命名该图标（如 主页、设置、相机、star、heart）。',
        '请仅返回严格 JSON，不要 markdown 代码块、不要任何其他文字：{"icons":[{"name":"...","box":[x1,y1,x2,y2]}]}',
      ].join('\n');

      const messages = [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: prompt },
            {
              type: 'image_url' as const,
              image_url: { url: imageBase64, detail: 'high' as const },
            },
          ],
        },
      ];

      const response = await client.invoke(messages, {
        model: 'doubao-seed-2-0-pro-260215',
        temperature: 0.1,
        streaming: false,
      });

      const parsed = extractJson<{ icons?: IconBox[] }>(response.content || '');
      if (parsed && Array.isArray(parsed.icons)) {
        boxes = parsed.icons
          .filter((it) => it && Array.isArray(it.box) && it.box.length === 4)
          .slice(0, 60);
      }
    } catch {
      boxes = [];
    }

    // 2) 按框裁剪成透明 PNG
    const padXRatio = Math.min(0.02, 8 / W);
    const padYRatio = Math.min(0.02, 8 / H);
    const items: SplitItem[] = [];

    for (const it of boxes) {
      const [x1, y1, x2, y2] = (it.box as number[]).map(Number);
      if (
        ![x1, y1, x2, y2].every(Number.isFinite) ||
        x2 <= x1 ||
        y2 <= y1
      ) {
        continue;
      }
      const fx1 = Math.max(0, Math.min(1, x1));
      const fy1 = Math.max(0, Math.min(1, y1));
      const fx2 = Math.max(0, Math.min(1, x2));
      const fy2 = Math.max(0, Math.min(1, y2));

      let left = Math.round(fx1 * W);
      let top = Math.round(fy1 * H);
      let width = Math.round((fx2 - fx1) * W);
      let height = Math.round((fy2 - fy1) * H);

      const px = Math.round(padXRatio * W);
      const py = Math.round(padYRatio * H);
      left = Math.max(0, left - px);
      top = Math.max(0, top - py);
      width = Math.min(W - left, width + 2 * px);
      height = Math.min(H - top, height + 2 * py);

      if (width < 8 || height < 8) continue;

      try {
        const png = await cropToPng(buf, left, top, width, height);
        items.push({
          name: String(it.name || 'icon'),
          dataUrl: png,
          w: width,
          h: height,
        });
      } catch {
        // 跳过无法裁剪的块
      }
    }

    if (items.length === 0) {
      // 降级：整图作为单个图标，保证有可导出的结果
      const png = await cropToPng(buf, 0, 0, W, H);
      return NextResponse.json({
        items: [{ name: 'icon', dataUrl: png, w: W, h: H }],
        degraded: true,
        note: 'AI 未能精确拆分出多个图标，已整体导出。建议更换为图标间距清晰、边界明确的拼合图。',
      });
    }

    return NextResponse.json({ items });
  } catch (error) {
    console.error('split route error:', error);
    return NextResponse.json({ error: '图标拆分失败，请重试' }, { status: 500 });
  }
}

/** 裁剪出指定区域，并将接近边框背景色的像素透明化 */
async function cropToPng(
  buf: Buffer,
  left: number,
  top: number,
  width: number,
  height: number,
): Promise<string> {
  const { data, info } = await sharp(buf)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const transparent = makeBgTransparent(data, info.width, info.height);
  const out = await sharp(transparent, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  return 'data:image/png;base64,' + out.toString('base64');
}

/** 将接近四角背景色的像素置为透明，使图标成为干净的透明 PNG */
function makeBgTransparent(data: Buffer, w: number, h: number): Buffer {
  const bg = cornerAvg(data, w, h);
  const tol = 46;
  const out = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (out[i + 3] === 0) continue;
      const dist =
        Math.abs(data[i] - bg[0]) +
        Math.abs(data[i + 1] - bg[1]) +
        Math.abs(data[i + 2] - bg[2]);
      if (dist < tol) {
        out[i + 3] = Math.round(255 * Math.max(0, Math.min(1, dist / tol)));
      }
    }
  }
  return out;
}

/** 取四角区域的平均色，作为待去除背景色的参考 */
function cornerAvg(data: Buffer, w: number, h: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 50));
  const regions = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  for (const [cx, cy] of regions) {
    for (let dy = -step; dy <= step; dy++) {
      for (let dx = -step; dx <= step; dx++) {
        const x = Math.max(0, Math.min(w - 1, cx + dx));
        const y = Math.max(0, Math.min(h - 1, cy + dy));
        const i = (y * w + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    }
  }
  if (!n) return [255, 255, 255];
  return [r / n, g / n, b / n];
}

/** 从文本中稳健地提取 JSON 对象 */
function extractJson<T>(text: string): T | null {
  if (!text) return null;
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import sharp, { type OverlayOptions } from 'sharp';

interface IconBox {
  name?: string;
  box?: number[];
}

interface ProcessedIcon {
  name: string;
  dataUrl: string;
  w: number;
  h: number;
}

interface BodyOpts {
  imageBase64?: string;
  targetSize?: number; // 高清目标边长(px)，默认 128
  cols?: number; // 雪碧图每行个数，0 表示一行铺开
  gap?: number; // 雪碧图间距(px)，默认 8
}

/**
 * 图标拆分管线：
 *  1) AI 视觉逐图标定位（精确到主体、排除阴影/高光/杂边）
 *  2) 每个图标裁剪 -> 去背景/透明化 -> 智能去边裁切 -> 高清放大(sharp 高质量插值 + 锐化)
 *  3) 组合成透明背景雪碧图，返回雪碧图 + 每个独立图标 + 雪碧图坐标元数据
 * Body: { imageBase64, targetSize?, cols?, gap? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BodyOpts;
    const { imageBase64 } = body;
    if (typeof imageBase64 !== 'string' || !imageBase64.startsWith('data:image')) {
      return NextResponse.json({ error: '无效的图片数据' }, { status: 400 });
    }

    const targetSize = Math.max(64, Math.min(512, Number(body.targetSize) || 128));
    const cols = Math.max(0, Math.floor(Number(body.cols) || 0));
    const gap = Math.max(0, Math.min(48, Number(body.gap) || 8));

    const buf = Buffer.from(imageBase64.split(',')[1], 'base64');
    const meta = await sharp(buf).metadata();
    const W = meta.width || 0;
    const H = meta.height || 0;
    if (!W || !H) {
      return NextResponse.json({ error: '无法读取图片尺寸' }, { status: 400 });
    }

    // 1) AI 视觉定位每个图标（提示精确到主体、排除阴影）
    let boxes: IconBox[] = [];
    let aiNote = '';
    try {
      const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
      const config = new Config();
      const client = new LLMClient(config, customHeaders);

      const prompt = [
        '这张图片通常是一张包含多个独立图标的拼合图 / 雪碧图 / 图标网格 / 图标集合。',
        '请把图中每个明显的独立图形（色块、符号、字符、形状、图标）都分别框出，即使它们形状相似、或呈规整的行列网格排列，网格中每个格子内的图形也要各自单独框出，不要合成一个、不要漏掉。',
        '需要你给出逐图标的边界框。',
        '要求：逐图标给框，不要合并、不要遗漏；即使有间距、网格线或装饰背景，也要把每个独立图形单独框出来。',
        '关键：边界框尽可能紧贴每个图形的轮廓主体，排除掉外侧的投影、阴影、高光、光晕和多余空白，作为后续去阴影的依据。',
        '忽略作为背景的填色区、网格线或大面积装饰底（若整图就是一个图形则只返回一个框）。',
        '每个图形用归一化坐标 box:[x1,y1,x2,y2] 表示外接矩形：x、y 取值 0~1，原点在左上角，向右为 x 增大、向下为 y 增大。',
        'name 用简洁中文或英文命名该图形（如 主页、设置、相机、star、heart；也可用 图形1、图形2 依次编号）。',
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
        boxes = (parsed.icons as IconBox[])
          .filter((it) => it && Array.isArray(it.box) && it.box.length === 4)
          .slice(0, 60);
      } else {
        aiNote = 'AI 未返回有效坐标。';
      }
    } catch {
      boxes = [];
      aiNote = 'AI 识别失败。';
    }

    // 2) 逐图标：裁剪 -> 透明化 -> trim 去边 -> 高清放大
    const rawIcons: ProcessedIcon[] = [];
    for (const it of boxes) {
      const [x1, y1, x2, y2] = (it.box as number[]).map(Number);
      if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) continue;
      const fx1 = Math.max(0, Math.min(1, x1));
      const fy1 = Math.max(0, Math.min(1, y1));
      const fx2 = Math.max(0, Math.min(1, x2));
      const fy2 = Math.max(0, Math.min(1, y2));
      const left = Math.round(fx1 * W);
      const top = Math.round(fy1 * H);
      const width = Math.max(4, Math.round((fx2 - fx1) * W));
      const height = Math.max(4, Math.round((fy2 - fy1) * H));

      try {
        const png = await enhanceIcon(buf, left, top, width, height, targetSize);
        const meta2 = await sharp(Buffer.from(png.split(',')[1], 'base64')).metadata();
        rawIcons.push({
          name: String(it.name || 'icon'),
          dataUrl: png,
          w: meta2.width || 0,
          h: meta2.height || 0,
        });
      } catch {
        // 跳过无法处理的块
      }
    }

    if (rawIcons.length === 0) {
      // 降级：AI 未判定为多个独立图标时，将整图作为一个图标走同一高清管线，保证有输出
      try {
        const png = await enhanceIcon(buf, 0, 0, W, H, targetSize);
        const metaF = await sharp(Buffer.from(png.split(',')[1], 'base64')).metadata();
        rawIcons.push({ name: 'icon', dataUrl: png, w: metaF.width || 0, h: metaF.height || 0 });
        aiNote = '未识别出多个独立图标，已按整图高清处理。建议上传图标间距清晰、边界明确的拼合图，可拆分出更精细的单图标。';
      } catch {
        return NextResponse.json({ error: '图片处理失败，请重试' }, { status: 500 });
      }
    }

    // 3) 组合雪碧图
    const sprite = await composeSprite(rawIcons, cols, gap, targetSize);

    return NextResponse.json({
      sprite: sprite.sprite,
      icons: rawIcons.map((i) => ({ name: i.name, dataUrl: i.dataUrl, w: i.w, h: i.h })),
      spriteMeta: {
        cols: sprite.cols,
        rows: sprite.rows,
        cellW: sprite.cellW,
        cellH: sprite.cellH,
        gap,
        items: sprite.perIcon,
      },
      note: aiNote ? `已自动高清放大(最长边 ${targetSize}px)、去除背景与杂边阴影。${aiNote}` : `已自动高清放大(最长边 ${targetSize}px)、去除背景与杂边阴影。`,
      sourceSize: { imageW: W, imageH: H },
    });
  } catch (error) {
    console.error('sprite route error:', error);
    return NextResponse.json({ error: '雪碧图生成失败，请重试' }, { status: 500 });
  }
}

/**
 * 单个图标增强流水线：裁剪 -> 背景透明化 -> trim 裁掉多余透明/杂边阴影 -> 高清放大 + 锐化
 */
async function enhanceIcon(
  buf: Buffer,
  left: number,
  top: number,
  width: number,
  height: number,
  targetSize: number,
): Promise<string> {
  // 用小容差透明化背景，避免误伤图标半透明质感
  const raw = await sharp(buf)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const transparent = makeBgTransparent(raw.data, raw.info.width, raw.info.height);

  // trim: 裁掉外侧纯透明/极淡边缘（含阴影的淡边），然后高清放大 + 锐化
  const out = await sharp(transparent, {
    raw: { width: raw.info.width, height: raw.info.height, channels: 4 },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({
      width: undefined,
      height: targetSize,
      fit: 'inside',
      withoutEnlargement: false,
      kernel: sharp.kernel.cubic,
    })
    .sharpen({ sigma: 1.2 })
    .png()
    .toBuffer();

  return 'data:image/png;base64,' + out.toString('base64');
}

interface SpriteResult {
  sprite: string;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  perIcon: { index: number; name: string; x: number; y: number; w: number; h: number }[];
}

/** 组合雪碧图：等间距、等格子，透明背景 */
async function composeSprite(
  icons: ProcessedIcon[],
  cols: number,
  gap: number,
  targetSize: number,
): Promise<SpriteResult> {
  if (cols <= 0) cols = icons.length; // 单行
  const rows = Math.ceil(icons.length / cols);
  const cellW = targetSize;
  const cellH = targetSize;

  const canvasW = cols * cellW + (cols + 1) * gap;
  const canvasH = rows * cellH + (rows + 1) * gap;

  const composites: OverlayOptions[] = [];
  const items: SpriteResult['perIcon'] = [];

  icons.forEach((icon, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (cellW + gap);
    const y = gap + row * (cellH + gap);
    // 居中放置（水平/垂直），保持各自宽高
    const ox = Math.round((cellW - icon.w) / 2);
    const oy = Math.round((cellH - icon.h) / 2);
    composites.push({
      input: Buffer.from(icon.dataUrl.split(',')[1], 'base64'),
      left: x + ox,
      top: y + oy,
    });
    items.push({ index: i, name: icon.name, x: x + ox, y: y + oy, w: icon.w, h: icon.h });
  });

  const spriteBuf = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return {
    sprite: 'data:image/png;base64,' + spriteBuf.toString('base64'),
    cols,
    rows,
    cellW,
    cellH,
    perIcon: items,
  };
}

/** 将接近四角背景色的像素置为透明 */
function makeBgTransparent(data: Buffer, w: number, h: number): Buffer {
  const bg = cornerAvg(data, w, h);
  const tol = 34;
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

/** 取四角区域平均色作为背景参考 */
function cornerAvg(data: Buffer, w: number, h: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
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

/** 从文本中稳健地提取 JSON */
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
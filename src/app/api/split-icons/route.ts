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

    // 1) AI 视觉定位每个图标（整图一次输出大量 bbox 易因输出超限返回空；先 AI 后确定性兜底，互不影响）
    let boxes = await locateIconsByStrips(buf, imageBase64, W, H, request);
    let aiNote = '';
    if (boxes.length === 0) {
      // AI 不可用/未识别时，用连通域算法按"与背景差异"切出多个真实图标区域，保证仍能拆分成多图标
      boxes = await locateIconsDeterministic(buf);
      if (boxes.length === 0) {
        aiNote = '未能识别出多个独立图标。建议上传图标间距清晰、边界明确的页面图。';
      } else {
        aiNote = 'AI 智能识别暂不可用，已按图形区域自动拆分为 ' + boxes.length + ' 个图标。';
      }
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
 * 图标识别定位：模型端一次输出大量 bbox 会因输出 token 上限被截断，返回空 choices；
 * 改为分批，每批只请求 4 个最清晰图标坐标，并把已定位区域传给模型让其续接，逐批累加去重。
 */
async function locateIconsByStrips(
  _buf: Buffer,
  imageBase64: string,
  W: number,
  H: number,
  request: NextRequest,
): Promise<IconBox[]> {
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const BATCH = 4;
  const MAX_ROUND = 8;
  const all: IconBox[] = [];
  let claimed: number[][] = [];
  let round = 0;
  while (round < MAX_ROUND) {
    let fresh: IconBox[] = [];
    for (let attempt = 0; attempt < 2 && fresh.length === 0; attempt++) {
      const found = await locateIconsBatch(imageBase64, claimed, BATCH, W, H, customHeaders).catch(
        (e) => {
          console.error('split-icons batch round', round, 'attempt', attempt, 'error:', (e as Error)?.message || e);
          return [] as IconBox[];
        },
      );
      fresh = [];
      for (const it of found) {
        if (!it || !Array.isArray(it.box) || it.box.length !== 4) continue;
        const [x1, y1, x2, y2] = (it.box as number[]).map(Number);
        if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) continue;
        const box = [
          Math.max(0, Math.min(1, x1 / W)),
          Math.max(0, Math.min(1, y1 / H)),
          Math.max(0, Math.min(1, x2 / W)),
          Math.max(0, Math.min(1, y2 / H)),
        ];
        if (claimed.some((c) => iou(c, box) > 0.5)) continue;
        fresh.push({ name: it.name, box });
      }
    }
    if (!fresh.length) break;
    all.push(...fresh);
    claimed.push(...fresh.map((f) => f.box as number[]));
    round++;
  }
  return all.slice(0, 80);
}

/**
 * 确定性图标定位（免 AI，作为兜底）：对降采样图做连通域分析，
 * 把"与主背景色差异较大"的像素聚类成若干独立图标区域。
 * 对 H5/应用截图（白色或浅色底 + 彩色图标/控件）效果稳定。
 */
async function locateIconsDeterministic(buf: Buffer): Promise<IconBox[]> {
  const meta = await sharp(buf).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) return [];

  const dw = Math.min(W, 360);
  const dh = Math.max(1, Math.round((dw * H) / W));
  const raw = await sharp(buf).resize(dw, dh, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  const iw = info.width;
  const ih = info.height;

  // 背景色 = 图像边界环上出现最多的颜色
  const freq = new Map<number, number>();
  const key = (r: number, g: number, b: number) => ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      if (x > 2 && y > 2 && x < iw - 3 && y < ih - 3) continue;
      const i = (y * iw + x) * 4;
      const k = key(data[i], data[i + 1], data[i + 2]);
      freq.set(k, (freq.get(k) || 0) + 1);
    }
  }
  let bgKey = -1;
  let best = -1;
  freq.forEach((c, k) => {
    if (c > best) {
      best = c;
      bgKey = k;
    }
  });
  const bgr = (bgKey >> 10) << 5;
  const bgg = ((bgKey >> 5) & 31) << 5;
  const bgb = (bgKey & 31) << 5;

  // foreground mask
  const fg = new Uint8Array(iw * ih);
  const TH = 55;
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const i = (y * iw + x) * 4;
      if (data[i + 3] < 40) continue;
      const d =
        Math.abs(data[i] - bgr) + Math.abs(data[i + 1] - bgg) + Math.abs(data[i + 2] - bgb);
      fg[y * iw + x] = d > TH ? 1 : 0;
    }
  }

  // 连通域（4 邻接）
  const label = new Int32Array(iw * ih).fill(-1);
  const comps: { n: number; x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let sy = 0; sy < ih; sy++) {
    for (let sx = 0; sx < iw; sx++) {
      const si = sy * iw + sx;
      if (fg[si] !== 1 || label[si] !== -1) continue;
      const id = comps.length;
      let n = 0;
      let x1 = sx;
      let y1 = sy;
      let x2 = sx;
      let y2 = sy;
      let cap = 1024;
      let sp = 0;
      let stack = new Int32Array(cap);
      stack[sp++] = si;
      label[si] = id;
      while (sp > 0) {
        const p = stack[--sp];
        n++;
        const px = p % iw;
        const py = (p / iw) | 0;
        if (px < x1) x1 = px;
        if (px > x2) x2 = px;
        if (py < y1) y1 = py;
        if (py > y2) y2 = py;
        const dirs: ReadonlyArray<readonly [number, number]> = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dx, dy] of dirs) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= iw || ny >= ih) continue;
          const ni = ny * iw + nx;
          if (fg[ni] === 1 && label[ni] === -1) {
            label[ni] = id;
            if (sp >= cap) {
              const n2 = cap * 2;
              const s2 = new Int32Array(n2);
              s2.set(stack);
              stack = s2;
              cap = n2;
            }
            stack[sp++] = ni;
          }
        }
      }
      comps.push({ n, x1, y1, x2, y2 });
    }
  }

  const area = iw * ih;
  const minArea = area * 0.001; // 0.1%
  const maxArea = area * 0.25; // 25%，过滤整块大面板/大背景
  const pad = 0.04;
  const boxes: IconBox[] = [];
  for (const c of comps) {
    if (c.n < minArea || c.n > maxArea) continue;
    const w = c.x2 - c.x1 + 1;
    const h = c.y2 - c.y1 + 1;
    if (w < 4 || h < 4) continue;
    const ar = w / h;
    if (ar < 0.25 || ar > 4) continue; // 过滤过扁/过高的分隔带
    const x1 = Math.max(0, (c.x1 - w * pad) / iw);
    const y1 = Math.max(0, (c.y1 - h * pad) / ih);
    const x2 = Math.min(1, (c.x2 + w * pad) / iw);
    const y2 = Math.min(1, (c.y2 + h * pad) / ih);
    boxes.push({ name: 'icon', box: [x1, y1, x2, y2] });
  }

  // 合并嵌套/重叠框：按面积从大到小，iou>0.3 视为重复保留大的
  boxes.sort((a, b) => {
    const ba = a.box as number[];
    const bb = b.box as number[];
    return (bb[2] - bb[0]) * (bb[3] - bb[1]) - (ba[2] - ba[0]) * (ba[3] - ba[1]);
  });
  const kept: IconBox[] = [];
  for (const b of boxes) {
    const bb = b.box as number[];
    if (kept.some((k) => iou(k.box as number[], bb) > 0.3)) continue;
    kept.push(b);
  }
  kept.sort((a, b) => {
    const ba = a.box as number[];
    const bb = b.box as number[];
    return ba[1] - bb[1] || ba[0] - bb[0];
  });
  return kept.slice(0, 60);
}

function iou(a: number[], b: number[]): number {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const ia = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const aa = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const ab = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  return ia / Math.max(1e-6, aa + ab - ia);
}

async function locateIconsBatch(
  imageBase64: string,
  claimed: number[][],
  batch: number,
  W: number,
  H: number,
  customHeaders: Record<string, string>,
): Promise<IconBox[]> {
  const config = new Config();
  const client = new LLMClient(config, customHeaders);
  const first = claimed.length === 0;
  const claimedDesc = first
    ? ''
    : '已框选的图标区域（像素坐标，忽略这些区域、别重复框选）：' +
      JSON.stringify(
        claimed.map((c) => [
          Math.round(c[0] * W),
          Math.round(c[1] * H),
          Math.round(c[2] * W),
          Math.round(c[3] * H),
        ]),
      ) +
      ' 请找还未被框选的下一批图标。';
  const prompt = [
    '这是一张应用界面 / H5 页面截图，分辨率 宽 ' + W + 'px、高 ' + H + 'px，里面分布着若干彼此独立、可单独导出的图形元素：带名称的功能图标按钮（如 闯关挑战、单词PK、设置、生词本）、纯小图标（收藏、五角星、房子等）、徽标、头像、系统控件等。',
    first ? '请找出页面上最清晰、边界最明确的前 ' + batch + ' 个图标。' : claimedDesc,
    '要单个图标单个框，不要把整排合并。',
    '只框住图形主体，不要把旁边文字、阴影、高光框进去。忽略整页大背景、分隔线、底部导航整体和纯文字标题。',
    '坐标用图片像素、整数，四点 box:[左上x,左上y,右下x,右下y]，原点在左上角。',
    '只返回严格 JSON，不要代码块、不要解释。没找到新图标返回 {"icons":[]}：{"icons":[{"name":"...","box":[x1,y1,x2,y2]}]}',
  ].join('\n');

  const response = await client.invoke(
    [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: prompt },
          {
            type: 'image_url' as const,
            image_url: { url: imageBase64, detail: 'low' as const },
          },
        ],
      },
    ],
    {
      model: 'qwen-3-5-plus-260215',
      temperature: 0.2,
      streaming: false,
    },
  );
  const parsed = extractJson<{ icons?: IconBox[] }>(response.content || '');
  if (parsed && Array.isArray(parsed.icons)) return parsed.icons as IconBox[];
  return [];
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
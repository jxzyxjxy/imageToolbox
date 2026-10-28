import Taro from '@tarojs/taro';

/**
 * 小程序新版 Canvas(type="2d") 封装 + 像素级图像算法。
 * 算法与 H5 端 image-processing.ts 保持一致（泛洪抠图 / 羽化 / 主体框 / 锐化）。
 */

export interface MiniImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MiniImage {
  src: string;
  width: number;
  height: number;
  onload: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
}

export interface MiniCanvasContext2D {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  globalCompositeOperation: string;
  imageSmoothingEnabled: boolean;
  drawImage: (...args: unknown[]) => void;
  getImageData: (x: number, y: number, w: number, h: number) => MiniImageData;
  putImageData: (data: MiniImageData, x: number, y: number) => void;
  createImageData: (w: number, h: number) => MiniImageData;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  clearRect: (x: number, y: number, w: number, h: number) => void;
  save: () => void;
  restore: () => void;
  translate: (x: number, y: number) => void;
  rotate: (angle: number) => void;
  scale: (x: number, y: number) => void;
  beginPath: () => void;
  arc: (x: number, y: number, r: number, s: number, e: number) => void;
  fill: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  stroke: () => void;
}

export interface MiniCanvas {
  width: number;
  height: number;
  getContext: (type: '2d') => MiniCanvasContext2D;
  createImage: () => MiniImage;
}

/** 通过 selector 获取 canvas 节点（页面内须存在 <canvas type="2d" id={id}>） */
export function getCanvas(id: string, scope?: unknown): Promise<MiniCanvas> {
  return new Promise((resolve, reject) => {
    let q = Taro.createSelectorQuery();
    if (scope) q = q.in(scope as never);
    q.select(`#${id}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res?.[0]?.node as MiniCanvas | undefined;
        if (!node) reject(new Error('画布初始化失败'));
        else resolve(node);
      });
  });
}

/** 加载图片到 canvas 可用 Image 对象 */
export function loadCanvasImage(
  canvas: MiniCanvas,
  src: string,
): Promise<MiniImage> {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err instanceof Error ? err : new Error('图片加载失败'));
    img.src = src;
  });
}

/** 导出 canvas 为临时图片文件（显式按像素尺寸导出，避免默认取显示尺寸被缩小） */
export function canvasToTempFile(
  canvas: MiniCanvas,
  opts: { fileType?: 'png' | 'jpg'; quality?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.canvasToTempFilePath({
      canvas: canvas as never,
      destWidth: canvas.width,
      destHeight: canvas.height,
      fileType: opts.fileType || 'png',
      quality: opts.quality ?? 0.92,
      success: (r) => resolve(r.tempFilePath),
      fail: (err) => reject(new Error(err.errMsg || '导出失败')),
    });
  });
}

/** 按最长边等比收敛尺寸 */
export function fitSize(
  w: number,
  h: number,
  maxDim: number,
): { w: number; h: number } {
  const ratio = Math.min(1, maxDim / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * ratio)), h: Math.max(1, Math.round(h * ratio)) };
}

/* ---------------- 以下为纯像素算法（与 H5 一致） ---------------- */

export interface SubjectBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function colorDistance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** 对 alpha 通道做盒式模糊（羽化边缘） */
function featherAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): void {
  const src = new Uint8ClampedArray(data);
  const r = Math.max(1, radius);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += src[(yy * width + xx) * 4 + 3];
          count++;
        }
      }
      data[(y * width + x) * 4 + 3] = Math.round(sum / count);
    }
  }
}

/**
 * 四角采样：取四个角各 6% 边长的方块求平均色，作为本地背景参考色。
 * 不依赖 AI，analyze 不可用时的可靠兜底（与 H5 sampleCornerColor 一致）。
 */
export function sampleCornerColorFromData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const size = Math.max(1, Math.round(Math.min(width, height) * 0.06));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const corners: Array<[number, number]> = [
    [0, 0],
    [width - size, 0],
    [0, height - size],
    [width - size, height - size],
  ];
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + size; y++) {
      for (let x = cx; x < cx + size; x++) {
        const i = (y * width + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * 泛洪抠图：从四边向内部生长，把与参考背景色相近且相连的区域 alpha 置 0，
 * 羽化边缘后返回主体边界框。直接原地修改 data。
 */
export function removeBackgroundPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  refRgb: [number, number, number],
  tolerance: number,
): SubjectBBox {
  const maxDist = (tolerance / 100) * 180;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const idx = (x: number, y: number) => y * width + x;

  for (let x = 0; x < width; x++) {
    queue.push(idx(x, 0), idx(x, height - 1));
  }
  for (let y = 0; y < height; y++) {
    queue.push(idx(0, y), idx(width - 1, y));
  }

  while (queue.length) {
    const p = queue.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const x = p % width;
    const y = (p / width) | 0;
    const o = p * 4;
    const d = colorDistance(
      data[o], data[o + 1], data[o + 2],
      refRgb[0], refRgb[1], refRgb[2],
    );
    if (d < maxDist) {
      data[o + 3] = 0;
      if (x > 0 && !visited[p - 1]) queue.push(p - 1);
      if (x < width - 1 && !visited[p + 1]) queue.push(p + 1);
      if (y > 0 && !visited[p - width]) queue.push(p - width);
      if (y < height - 1 && !visited[p + width]) queue.push(p + width);
    }
  }

  featherAlpha(data, width, height, 2);
  return getSubjectBBoxFromData(data, width, height);
}

/** 非透明像素边界框 */
export function getSubjectBBoxFromData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): SubjectBBox {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { x: 0, y: 0, w: width, h: height };
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** RGB 盒式模糊（替代小程序不支持的 ctx.filter blur，供锐化取低频层） */
function boxBlurRGB(
  src: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const o = (yy * width + xx) * 4;
          r += src[o];
          g += src[o + 1];
          b += src[o + 2];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = src[o + 3];
    }
  }
  return out;
}

/** Unsharp Mask 锐化（与 H5 同款公式，低频层用盒式模糊近似高斯） */
export function unsharpMaskPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  factor: number,
): void {
  const blurred = boxBlurRGB(data, width, height);
  const amount = Math.min(1.4, 0.6 + factor * 0.2);
  const threshold = 2;
  for (let p = 0; p < data.length; p += 4) {
    for (let c = 0; c < 3; c++) {
      const original = data[p + c];
      const diff = original - blurred[p + c];
      const value = Math.abs(diff) >= threshold ? original + diff * amount : original;
      data[p + c] = Math.max(0, Math.min(255, value));
    }
  }
}

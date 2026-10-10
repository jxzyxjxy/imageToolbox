// 客户端图像处理工具库（纯前端，基于 Canvas，不上传原始图片）

export interface ProcessedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export interface CompressResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  size: number;
}

/** 读取 File 为 DataURL */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 从 DataURL 加载图片 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/** 将图片绘制到 canvas（可选最大边长裁剪），兼容 HTMLImageElement 与 Canvas */
export function drawToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  maxDim?: number,
): HTMLCanvasElement {
  const isImg = source instanceof HTMLImageElement;
  let w = isImg ? source.naturalWidth : source.width;
  let h = isImg ? source.naturalHeight : source.height;
  if (maxDim) {
    const ratio = Math.min(1, maxDim / Math.max(w, h));
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

/** RGB 距离（欧氏） */
export function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 智能抠图：从图像四周向内部生长，将与参考背景色相近且相连的区域设为透明。
 * 返回新的 Canvas（带透明通道），并附主体边界框。
 */
export function removeBackground(
  source: CanvasImageSource | HTMLCanvasElement,
  refRgb: [number, number, number],
  tolerance: number,
): ProcessedImage & { bbox: { x: number; y: number; w: number; h: number } } {
  const canvas =
    source instanceof HTMLCanvasElement
      ? source
      : (() => {
          const c = document.createElement('canvas');
          c.width = (source as HTMLImageElement).naturalWidth;
          c.height = (source as HTMLImageElement).naturalHeight;
          c.getContext('2d')!.drawImage(source, 0, 0);
          return c;
        })();

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // tolerance(0-100) → 颜色距离阈值
  const maxDist = (tolerance / 100) * 180;

  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  const idx = (x: number, y: number) => y * width + x;

  // 种子：四条边框上的像素
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
      data[o],
      data[o + 1],
      data[o + 2],
      refRgb[0],
      refRgb[1],
      refRgb[2],
    );
    if (d < maxDist) {
      // 标记为背景
      data[o + 3] = 0;
      if (x > 0 && !visited[p - 1]) queue.push(p - 1);
      if (x < width - 1 && !visited[p + 1]) queue.push(p + 1);
      if (y > 0 && !visited[p - width]) queue.push(p - width);
      if (y < height - 1 && !visited[p + width]) queue.push(p + width);
    }
  }

  // 对 alpha 通道做少量模糊，柔化边缘
  featherAlpha(data, width, height, imageData, 2);

  ctx.putImageData(imageData, 0, 0);

  // 计算主体边界框
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[idx(x, y) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    minX = 0;
    minY = 0;
    maxX = width;
    maxY = height;
  }

  return {
    canvas,
    width,
    height,
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

/** 对 alpha 通道做盒式模糊（羽化边缘） */
function featherAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  imageData: ImageData,
  radius: number,
): void {
  const src = new Uint8ClampedArray(imageData.data);
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

/** 边缘检测：返回图像中非透明的边界框（供证件照适配） */
export function getSubjectBBox(canvas: HTMLCanvasElement): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
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
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 图片压缩：绘制并导出指定格式/质量 */
export async function compressImage(
  img: HTMLImageElement,
  opts: {
    quality: number;
    format: 'image/jpeg' | 'image/webp' | 'image/png';
    maxDim?: number;
  },
): Promise<CompressResult> {
  const canvas = drawToCanvas(img, opts.maxDim);
  const { width, height } = canvas;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, opts.format, opts.quality),
  );
  if (!blob) throw new Error('压缩失败');
  const dataUrl = canvas.toDataURL(opts.format, opts.quality);
  return { blob, dataUrl, width, height, size: blob.size };
}

/** 将透明主体合成到纯色背景的证件照画布 */
export function makeIdPhoto(
  subjectCanvas: HTMLCanvasElement,
  bgColor: string,
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, outW, outH);

  const bbox = getSubjectBBox(subjectCanvas);
  if (bbox.w <= 0 || bbox.h <= 0) {
    ctx.drawImage(subjectCanvas, 0, 0, outW, outH);
    return out;
  }

  // cover 适配：主体占满画布，人脸向上（顶部留留白靠重心上移）
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const scale = Math.max(outW / bbox.w, outH / bbox.h);
  const dw = bbox.w * scale;
  const dh = bbox.h * scale;
  // 以 bbox 中心为锚，整体略上移 4%，让人脸更接近顶部，更符合证件照构图
  const dx = outW / 2 - (cx - bbox.x) * scale;
  const dy = outH / 2 - (cy - bbox.y) * scale - outH * 0.04;
  ctx.drawImage(subjectCanvas, dx, dy, dw, dh);
  return out;
}

/** Canvas → Blob */
export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('导出失败'))),
      type,
      quality,
    );
  });
}

/** 触发浏览器下载（fetch + blob，兼容跨域） */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 格式化文件大小 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}
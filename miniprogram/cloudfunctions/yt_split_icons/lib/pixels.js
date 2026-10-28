/**
 * 纯 JS 图像工具（jimp 0.16）：解码缩放、BFS 泛洪抠白底、透明化、trim、轻锐化。
 * 云函数无法安装 sharp 等原生模块，像素算法全部基于 bitmap（RGBA Buffer）实现。
 */
const Jimp = require('jimp');

/** 读取并限长边（默认 1600），返回 jimp 图像 */
async function readLimited(buffer, maxSide = 1600) {
  const img = await Jimp.read(buffer);
  const { width, height } = img.bitmap;
  const k = Math.min(1, maxSide / Math.max(width, height));
  if (k < 1) {
    img.resize(Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)), Jimp.RESIZE_BICUBIC);
  }
  return img;
}

/** 转方舟参考图 data URL（JPEG，长边 ≤2048，q85） */
async function toReferenceDataUrl(buffer) {
  const img = await readLimited(buffer, 2048);
  const out = await img.quality(85).getBufferAsync(Jimp.MIME_JPEG);
  return 'data:image/jpeg;base64,' + out.toString('base64');
}

/** 压缩出内容安全送检小图（JPEG Buffer） */
async function toSecCheckBuffer(buffer) {
  const img = await readLimited(buffer, 480);
  return img.quality(60).getBufferAsync(Jimp.MIME_JPEG);
}

/** 判断图像是否含真实透明像素 */
function hasTransparent(img) {
  const { data } = img.bitmap;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true;
  }
  return false;
}

/**
 * BFS 泛洪抠白底（与 H5 服务端 remove-bg.ts 同算法）：
 * 从四边泛洪，只把与边缘相连的近白色区域置透明，不误伤主体内部白色；
 * 与背景相邻的前景像素做半透明羽化。
 */
function removeWhiteBackground(img) {
  const { width, height, data } = img.bitmap;
  const px = data;
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isNearWhite = (i) => {
    const o = i * 4;
    const r = px[o];
    const g = px[o + 1];
    const b = px[o + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return min > 232 && max - min < 16;
  };

  const push = (i) => {
    if (visited[i] === 0 && isNearWhite(i)) {
      visited[i] = 1;
      queue[tail++] = i;
    }
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = Math.floor(i / width);
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }

  for (let i = 0; i < total; i++) {
    if (visited[i] === 1) px[i * 4 + 3] = 0;
  }
  for (let i = 0; i < total; i++) {
    if (visited[i] === 1) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    const nearBg =
      (x > 0 && visited[i - 1] === 1) ||
      (x < width - 1 && visited[i + 1] === 1) ||
      (y > 0 && visited[i - width] === 1) ||
      (y < height - 1 && visited[i + width] === 1);
    if (nearBg) px[i * 4 + 3] = 150;
  }
  return img;
}

/** 四角采样背景色 + 容差透明化（图标拆分用） */
function makeBgTransparent(img, tol = 34) {
  const { width: w, height: h, data } = img.bitmap;
  // 四角 4x4 均值作背景色
  let br = 0;
  let bg = 0;
  let bb = 0;
  let n = 0;
  const corners = [
    [0, 0],
    [w - 4, 0],
    [0, h - 4],
    [w - 4, h - 4],
  ];
  for (const [cx, cy] of corners) {
    for (let y = Math.max(0, cy); y < Math.min(h, cy + 4); y++) {
      for (let x = Math.max(0, cx); x < Math.min(w, cx + 4); x++) {
        const i = (y * w + x) * 4;
        br += data[i];
        bg += data[i + 1];
        bb += data[i + 2];
        n++;
      }
    }
  }
  br /= n;
  bg /= n;
  bb /= n;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) continue;
      const dist = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
      if (dist < tol) {
        data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, dist / tol)));
      }
    }
  }
  return img;
}

/** 非透明像素 bbox；无内容返回 null */
function alphaBBox(img) {
  const { width: w, height: h, data } = img.bitmap;
  let x1 = w;
  let y1 = h;
  let x2 = -1;
  let y2 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) return null;
  return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

/** 轻锐化（3x3 unsharp mask，仅用于小图如图标） */
function unsharpMask(img, amount = 0.5, radius = 1) {
  const { width: w, height: h, data } = img.bitmap;
  const src = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let n = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            sum += src[(ny * w + nx) * 4 + c];
            n++;
          }
        }
        const blur = sum / n;
        const i = (y * w + x) * 4 + c;
        const v = src[i] + amount * (src[i] - blur);
        data[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
    }
  }
  return img;
}

module.exports = {
  Jimp,
  readLimited,
  toReferenceDataUrl,
  toSecCheckBuffer,
  hasTransparent,
  removeWhiteBackground,
  makeBgTransparent,
  alphaBBox,
  unsharpMask,
};

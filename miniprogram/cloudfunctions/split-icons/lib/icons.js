/**
 * 确定性图标切割（移植自 H5 服务端 split-icons 的连通域兜底算法）：
 * 降采样 → 以边界主色为背景 → 前景 mask → 4 邻接连通域 → 过滤/合并 → 原图坐标框。
 * 对 H5/应用截图（浅色底 + 彩色图标）效果稳定。
 */
const { Jimp } = require('./pixels');

function iou(a, b) {
  const ix1 = Math.max(a[0], b[0]);
  const iy1 = Math.max(a[1], b[1]);
  const ix2 = Math.min(a[2], b[2]);
  const iy2 = Math.min(a[3], b[3]);
  const ia = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const aa = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const ab = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  return ia / Math.max(1e-6, aa + ab - ia);
}

/**
 * 定位图标框，返回归一化坐标 [{ name, box: [x1,y1,x2,y2] }]（0~1）。
 * @param img jimp 图像（原始尺寸）
 */
function locateIcons(img) {
  const W = img.bitmap.width;
  const H = img.bitmap.height;
  if (!W || !H) return [];

  // 降采样到宽 360 做连通域（快且抗噪）
  const dw = Math.min(W, 360);
  const dh = Math.max(1, Math.round((dw * H) / W));
  const small = img.clone().resize(dw, dh, Jimp.RESIZE_BILINEAR);
  const data = small.bitmap.data;
  const iw = dw;
  const ih = dh;

  // 背景色 = 边界环上出现最多的颜色（5bit 量化）
  const freq = new Map();
  const key = (r, g, b) => ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
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

  // 前景 mask：与背景差异 > 阈值
  const fg = new Uint8Array(iw * ih);
  const TH = 55;
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const i = (y * iw + x) * 4;
      if (data[i + 3] < 40) continue;
      const d = Math.abs(data[i] - bgr) + Math.abs(data[i + 1] - bgg) + Math.abs(data[i + 2] - bgb);
      fg[y * iw + x] = d > TH ? 1 : 0;
    }
  }

  // 4 邻接连通域
  const label = new Int32Array(iw * ih).fill(-1);
  const comps = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
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

  // 过滤：面积 0.1%~25%，过滤过扁/过高的分隔带
  const area = iw * ih;
  const minArea = area * 0.001;
  const maxArea = area * 0.25;
  const pad = 0.04;
  const boxes = [];
  for (const c of comps) {
    if (c.n < minArea || c.n > maxArea) continue;
    const w = c.x2 - c.x1 + 1;
    const h = c.y2 - c.y1 + 1;
    if (w < 4 || h < 4) continue;
    const ar = w / h;
    if (ar < 0.25 || ar > 4) continue;
    boxes.push({
      name: 'icon',
      box: [
        Math.max(0, (c.x1 - w * pad) / iw),
        Math.max(0, (c.y1 - h * pad) / ih),
        Math.min(1, (c.x2 + w * pad) / iw),
        Math.min(1, (c.y2 + h * pad) / ih),
      ],
    });
  }

  // 合并嵌套/重叠：按面积从大到小，iou>0.3 保留大的
  boxes.sort((a, b) => {
    const ba = a.box;
    const bb = b.box;
    return (bb[2] - bb[0]) * (bb[3] - bb[1]) - (ba[2] - ba[0]) * (ba[3] - ba[1]);
  });
  const kept = [];
  for (const b of boxes) {
    if (kept.some((k) => iou(k.box, b.box) > 0.3)) continue;
    kept.push(b);
  }
  kept.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  return kept.slice(0, 60);
}

module.exports = { locateIcons, iou };

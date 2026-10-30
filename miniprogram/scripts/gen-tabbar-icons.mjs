// 生成 tabBar 图标（81x81 PNG，零外部依赖：Node zlib 手写 PNG 编码 + 像素级几何绘制）
// 用法：node scripts/gen-tabbar-icons.mjs
// 输出：src/assets/tabbar/{pic,video}-{off,on}.png
// 小程序 tabBar iconPath 引用 'assets/tabbar/xxx.png'，由 config/index.ts 的 copy 配置拷入 dist

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../src/assets/tabbar');

/* ---------- PNG 编码（RGBA8，无滤波） ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 每行前置 filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 几何判定 ---------- */

/** 点是否在圆角矩形描边环带内（x0,y0,x1,y1 为外沿，r 圆角，w 描边宽） */
function inRoundRectStroke(x, y, x0, y0, x1, y1, r, w) {
  const inOuter = inRoundRect(x, y, x0, y0, x1, y1, r);
  const inInner = inRoundRect(x, y, x0 + w, y0 + w, x1 - w, y1 - w, Math.max(0, r - w));
  return inOuter && !inInner;
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.01;
}

/** 点是否在圆内 */
function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** 点是否在三角形内（重心法） */
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < -0.01 || d2 < -0.01 || d3 < -0.01;
  const hasPos = d1 > 0.01 || d2 > 0.01 || d3 > 0.01;
  return !(hasNeg && hasPos);
}

/* ---------- 图标绘制 ---------- */

const SIZE = 81;
const RGBA_OFF = [148, 163, 184]; // #94a3b8
const RGBA_ON = [99, 102, 241]; // #6366f1

function drawPicIcon(color) {
  // 图片：圆角方框 + 左上太阳 + 底部山形
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const fx = x + 0.5;
      const fy = y + 0.5;
      const hit =
        inRoundRectStroke(fx, fy, 10, 10, 71, 71, 14, 5) ||
        inCircle(fx, fy, 29, 29, 7) ||
        inTriangle(fx, fy, 18, 61, 43, 32, 68, 61);
      if (hit) {
        const i = (y * SIZE + x) * 4;
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = 255;
      }
    }
  }
  return encodePNG(SIZE, SIZE, rgba);
}

function drawVideoIcon(color) {
  // 视频：圆角方框（屏幕）+ 中央播放三角
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const fx = x + 0.5;
      const fy = y + 0.5;
      const hit =
        inRoundRectStroke(fx, fy, 10, 10, 71, 71, 14, 5) ||
        inTriangle(fx, fy, 33, 27, 33, 55, 59, 41);
      if (hit) {
        const i = (y * SIZE + x) * 4;
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = 255;
      }
    }
  }
  return encodePNG(SIZE, SIZE, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'pic-off.png'), drawPicIcon(RGBA_OFF));
fs.writeFileSync(path.join(OUT_DIR, 'pic-on.png'), drawPicIcon(RGBA_ON));
fs.writeFileSync(path.join(OUT_DIR, 'video-off.png'), drawVideoIcon(RGBA_OFF));
fs.writeFileSync(path.join(OUT_DIR, 'video-on.png'), drawVideoIcon(RGBA_ON));
console.log(`[icons] 生成 4 个 tabBar 图标 -> ${OUT_DIR}`);

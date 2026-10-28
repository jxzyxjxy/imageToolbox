/**
 * 图标拆分（纯 JS 版，与 H5 服务端切割算法一致）：
 *   1) 连通域定位各图标框 → 2) 逐块裁剪/透明化/trim/高清放大/轻锐化 → 3) 合成透明雪碧图
 * event: { fileID, targetSize?, cols?, gap? }
 * 返回: { icons: [{ name, fileID, w, h }], spriteFileID, spriteMeta, note, remaining, limit, error?, code? }
 */
const cloud = require('wx-server-sdk');
const { consume } = require('./lib/limit');
const storage = require('./lib/storage');
const pixels = require('./lib/pixels');
const { locateIcons } = require('./lib/icons');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { Jimp } = pixels;

/** 单块图标增强管线：裁剪 → 背景透明化 → trim → 等比放大到 targetSize → 轻锐化 */
async function enhanceIcon(srcImg, left, top, width, height, targetSize) {
  const piece = srcImg.clone().crop(left, top, width, height);
  pixels.makeBgTransparent(piece);
  const bbox = pixels.alphaBBox(piece);
  if (bbox) {
    piece.crop(bbox.x, bbox.y, bbox.w, bbox.h);
  }
  // 等比缩放到最长边 targetSize
  const { width: w, height: h } = piece.bitmap;
  const k = targetSize / Math.max(w, h);
  piece.resize(
    Math.max(1, Math.round(w * k)),
    Math.max(1, Math.round(h * k)),
    Jimp.RESIZE_BICUBIC,
  );
  pixels.unsharpMask(piece, 0.5, 1);
  return piece;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const fileID = event && event.fileID;
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    return { error: '缺少图片文件' };
  }

  const targetSize = Math.max(64, Math.min(512, Number(event.targetSize) || 128));
  const cols = Math.max(0, Math.floor(Number(event.cols) || 0));
  const gap = Math.max(0, Math.min(48, Number(event.gap) || 8));

  // 每日限频
  const db = cloud.database();
  const quota = await consume(db, OPENID, 'split-icons');
  if (!quota.ok) return { error: quota.error, code: 'LIMIT', remaining: 0, limit: quota.limit };

  try {
    if (fileID.includes('/inputs/')) await storage.register(cloud, fileID, 'inputs', OPENID);
    const raw = await storage.download(cloud, fileID);
    const srcImg = await Jimp.read(raw);
    const W = srcImg.bitmap.width;
    const H = srcImg.bitmap.height;
    if (!W || !H) return { error: '无法读取图片尺寸' };

    // 1) 连通域定位（归一化坐标 → 原图像素）
    let boxes = locateIcons(srcImg);
    let note = '';
    if (boxes.length === 0) {
      boxes = [{ name: 'icon', box: [0, 0, 1, 1] }];
      note = '未识别出多个独立图标，已按整图高清处理。建议上传图标间距清晰、边界明确的拼合图。';
    }

    // 2) 逐块增强 + 上传
    const icons = [];
    const pieces = [];
    for (const it of boxes) {
      const [x1, y1, x2, y2] = it.box;
      const left = Math.round(x1 * W);
      const top = Math.round(y1 * H);
      const width = Math.max(4, Math.round((x2 - x1) * W));
      const height = Math.max(4, Math.round((y2 - y1) * H));
      try {
        const piece = await enhanceIcon(srcImg, left, top, width, height, targetSize);
        const buf = await piece.getBufferAsync(Jimp.MIME_PNG);
        const id = await storage.upload(cloud, OPENID, buf, 'png');
        icons.push({ name: it.name, fileID: id, w: piece.bitmap.width, h: piece.bitmap.height });
        pieces.push(piece);
      } catch (e) {
        console.warn('[split-icons] 跳过无法处理的块:', e && e.message);
      }
    }
    if (icons.length === 0) return { error: '图片处理失败，请重试' };

    // 3) 合成透明雪碧图
    const realCols = cols > 0 ? cols : icons.length;
    const rows = Math.ceil(icons.length / realCols);
    const cellW = targetSize;
    const cellH = targetSize;
    const canvasW = realCols * cellW + (realCols + 1) * gap;
    const canvasH = rows * cellH + (rows + 1) * gap;
    const sprite = new Jimp(canvasW, canvasH, 0x00000000);
    const items = [];
    for (let i = 0; i < pieces.length; i++) {
      const col = i % realCols;
      const row = Math.floor(i / realCols);
      const x = gap + col * (cellW + gap);
      const y = gap + row * (cellH + gap);
      const ox = Math.round((cellW - pieces[i].bitmap.width) / 2);
      const oy = Math.round((cellH - pieces[i].bitmap.height) / 2);
      sprite.composite(pieces[i], x + ox, y + oy);
      items.push({
        index: i,
        name: icons[i].name,
        x: x + ox,
        y: y + oy,
        w: icons[i].w,
        h: icons[i].h,
      });
    }
    const spriteBuf = await sprite.getBufferAsync(Jimp.MIME_PNG);
    const spriteFileID = await storage.upload(cloud, OPENID, spriteBuf, 'png');

    return {
      icons,
      spriteFileID,
      spriteMeta: { cols: realCols, rows, cellW, cellH, gap, items },
      note:
        `已自动高清放大(最长边 ${targetSize}px)、去除背景与杂边阴影。` + note,
      sourceSize: { imageW: W, imageH: H },
      remaining: quota.remaining,
      limit: quota.limit,
    };
  } catch (err) {
    console.error('[split-icons] 失败:', err);
    return {
      error: (err && err.message) || '图标拆分失败，请重试',
      code: (err && err.code) || undefined,
    };
  }
};

import sharp from 'sharp';

/**
 * 将白底图抠成透明背景 PNG。
 *
 * 从图像四边做泛洪填充（BFS），只把与边缘相连的近白色区域置为透明，
 * 不会误伤主体内部的白色区域（如白色按钮面）；并对与背景相邻的
 * 前景像素做半透明羽化，减少边缘锯齿。
 */
export async function removeWhiteBackground(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const px = new Uint8Array(data.buffer.slice(0));
  const total = width * height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isNearWhite = (i: number): boolean => {
    const o = i * 4;
    const r = px[o];
    const g = px[o + 1];
    const b = px[o + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return min > 232 && max - min < 16;
  };

  const push = (i: number): void => {
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

  // 背景像素置透明
  for (let i = 0; i < total; i++) {
    if (visited[i] === 1) px[i * 4 + 3] = 0;
  }
  // 边缘羽化：与背景相邻的前景像素半透明
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

  return sharp(px, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

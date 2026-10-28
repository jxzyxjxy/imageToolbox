import { useState } from 'react';
import { View, Text, Image, Slider, Button, Canvas } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { chooseImage, saveToAlbum, formatSize, ChosenImage } from '../../utils/image';
import { canvasToTempFile, getCanvas, loadCanvasImage } from '../../utils/canvas';
import './index.scss';

interface CompressResult {
  path: string;
  size: number;
  /** 压缩效果不理想时直接保留原图 */
  keptOriginal?: boolean;
}

interface ImageMeta {
  width: number;
  height: number;
  orientation?: string;
}

export default function Compress() {
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [quality, setQuality] = useState(60);
  const [compressing, setCompressing] = useState(false);
  const [result, setResult] = useState<CompressResult | null>(null);

  const pickImage = async () => {
    try {
      const chosen = await chooseImage();
      if (!chosen) return;
      setImage(chosen);
      setResult(null);
    } catch (err) {
      console.error(err);
    }
  };

  const getFileSize = (filePath: string): Promise<number> =>
    new Promise((resolve) => {
      Taro.getFileInfo({
        filePath,
        success: (r) => resolve(r.size),
        fail: () => resolve(0),
      });
    });

  const getImageMeta = (src: string): Promise<ImageMeta | null> =>
    new Promise((resolve) => {
      Taro.getImageInfo({
        src,
        success: (r) =>
          resolve({
            width: r.width,
            height: r.height,
            orientation: (r as { orientation?: string }).orientation,
          }),
        fail: () => resolve(null),
      });
    });

  /** 显示方向尺寸：EXIF right/left 时宽高互换 */
  const displaySize = (meta: ImageMeta) => {
    const rotated = meta.orientation === 'right' || meta.orientation === 'left';
    return rotated
      ? { w: meta.height, h: meta.width, rotated }
      : { w: meta.width, h: meta.height, rotated };
  };

  /** 压缩结果是否保持了原图的显示方向（竖拍不能被压成横躺） */
  const isDirectionKept = async (src: string, out: string): Promise<boolean> => {
    const [a, b] = await Promise.all([getImageMeta(src), getImageMeta(out)]);
    if (!a || !b) return true; // 读不到元信息时不拦
    const da = displaySize(a);
    const db = displaySize(b);
    return (da.w < da.h) === (db.w < db.h);
  };

  /**
   * canvas 兜底压缩：按 EXIF 方向正确绘制，阶梯缩小尺寸，
   * 直到体积小于原图；全部失败返回 null。
   */
  const canvasCompress = async (
    src: string,
    qualityPct: number,
    originalSize: number,
  ): Promise<{ path: string; size: number } | null> => {
    try {
      const meta = await getImageMeta(src);
      if (!meta) return null;
      const disp = displaySize(meta);
      const canvas = await getCanvas('compressCanvas');
      const ctx = canvas.getContext('2d');
      const img = await loadCanvasImage(canvas, src);
      const scales = [1, 0.8, 0.62, 0.45, 0.33];
      for (const s of scales) {
        const dw = Math.max(1, Math.round(disp.w * s));
        const dh = Math.max(1, Math.round(disp.h * s));
        canvas.width = dw;
        canvas.height = dh;
        ctx.clearRect(0, 0, dw, dh);
        ctx.save();
        if (meta.orientation === 'right') {
          ctx.translate(dw, 0);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(img as never, 0, 0, dh, dw);
        } else if (meta.orientation === 'left') {
          ctx.translate(0, dh);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(img as never, 0, 0, dh, dw);
        } else if (meta.orientation === 'down') {
          ctx.translate(dw, dh);
          ctx.rotate(Math.PI);
          ctx.drawImage(img as never, 0, 0, dw, dh);
        } else {
          ctx.drawImage(img as never, 0, 0, dw, dh);
        }
        ctx.restore();
        const out = await canvasToTempFile(canvas, {
          fileType: 'jpg',
          quality: qualityPct / 100,
        });
        const size = await getFileSize(out);
        if (size > 0 && size < originalSize) return { path: out, size };
      }
      return null;
    } catch (err) {
      console.error('canvasCompress failed', err);
      return null;
    }
  };

  const compress = async () => {
    if (!image) {
      Taro.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    setCompressing(true);
    try {
      // 1) 官方压缩，校验体积与方向
      let out: CompressResult | null = null;
      try {
        const res = await Taro.compressImage({
          src: image.filePath,
          quality,
          compressedWidth: 0,
          compressedHeight: 0,
        });
        const size = await getFileSize(res.tempFilePath);
        const dirOk = await isDirectionKept(image.filePath, res.tempFilePath);
        if (size > 0 && size < image.size && dirOk) {
          out = { path: res.tempFilePath, size };
        }
      } catch (err) {
        console.error('compressImage failed', err);
      }
      // 2) canvas 阶梯压缩兜底（修正 EXIF 方向 + 缩小尺寸）
      if (!out) {
        out = await canvasCompress(image.filePath, quality, image.size);
      }
      // 3) 仍压不小 → 保留原图，绝不让"压缩"越压越大
      if (!out) {
        out = { path: image.filePath, size: image.size, keptOriginal: true };
      }
      setResult(out);
      if (out.keptOriginal) {
        Taro.showToast({ title: '原图已足够小，已保留原图', icon: 'none' });
      }
    } finally {
      setCompressing(false);
    }
  };

  const ratio =
    image && result && image.size > 0 && !result.keptOriginal
      ? Math.max(0, Math.round((1 - result.size / image.size) * 100))
      : 0;

  return (
    <View className="page">
      <View className="banner">
        <Text className="banner__title">本地图片压缩</Text>
        <Text className="banner__desc">不出手机，快速减小图片体积</Text>
      </View>

      {/* 选图 */}
      <View className="card">
        <Text className="card__label">原始图片</Text>
        {image ? (
          <View className="pick" onClick={pickImage}>
            <Image className="pick__img" src={image.filePath} mode="aspectFit" />
            <Text className="pick__size">
              {image.width}×{image.height} · {formatSize(image.size)}
            </Text>
          </View>
        ) : (
          <View className="pick pick--empty" onClick={pickImage}>
            <Text className="pick__plus">＋</Text>
            <Text className="pick__hint">点击选择图片</Text>
          </View>
        )}
      </View>

      {/* 质量 */}
      <View className="card">
        <View className="card__label-row">
          <Text className="card__label">压缩质量</Text>
          <Text className="card__value">{quality}%</Text>
        </View>
        <Slider
          min={10}
          max={100}
          step={5}
          value={quality}
          activeColor="#10b981"
          onChange={(e) => setQuality(e.detail.value)}
        />
        <Text className="card__tip">质量越低体积越小，画质也会下降</Text>
      </View>

      {/* 结果 */}
      {result && (
        <View className="card">
          <Text className="card__label">压缩结果</Text>
          <Image className="result__img" src={result.path} mode="aspectFit" />
          <View className="result__stats">
            <View className="result__stat">
              <Text className="result__num">{formatSize(image?.size ?? 0)}</Text>
              <Text className="result__cap">压缩前</Text>
            </View>
            <Text className="result__arrow">→</Text>
            <View className="result__stat">
              <Text className="result__num result__num--ok">
                {formatSize(result.size)}
              </Text>
              <Text className="result__cap">
                {result.keptOriginal ? '已保留原图' : `压缩后（-${ratio}%）`}
              </Text>
            </View>
          </View>
          <Button className="result__save" onClick={() => saveToAlbum(result.path)}>
            保存到相册
          </Button>
        </View>
      )}

      <View className="footer">
        <Button
          className={`footer__btn ${compressing ? 'footer__btn--disabled' : ''}`}
          disabled={compressing}
          onClick={compress}
        >
          {compressing ? '压缩中…' : '开始压缩'}
        </Button>
      </View>
      <View className="footer-placeholder" />
      {/* 隐藏画布：EXIF 方向修正与阶梯压缩兜底 */}
      <Canvas canvasId="compressCanvas" id="compressCanvas" className="compress-canvas" />
    </View>
  );
}

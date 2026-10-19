import { useState } from 'react';
import { View, Text, Image, Slider, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { chooseImage, saveToAlbum, formatSize, ChosenImage } from '../../utils/image';
import './index.scss';

interface CompressResult {
  path: string;
  size: number;
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

  const compress = async () => {
    if (!image) {
      Taro.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    setCompressing(true);
    try {
      const res = await Taro.compressImage({
        src: image.filePath,
        quality,
        compressedWidth: 0,
        compressedHeight: 0,
      });
      const size = await getFileSize(res.tempFilePath);
      setResult({ path: res.tempFilePath, size });
    } catch (err) {
      Taro.showToast({ title: '压缩失败，请重试', icon: 'none' });
    } finally {
      setCompressing(false);
    }
  };

  const ratio =
    image && result && image.size > 0
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
              <Text className="result__cap">压缩后（-{ratio}%）</Text>
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
    </View>
  );
}

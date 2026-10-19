import { useRef, useState } from 'react';
import { View, Text, Image, Slider, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { post } from '../api/client';
import {
  chooseImage,
  fileToDataUrl,
  dataUrlToTempFile,
  saveToAlbum,
  ChosenImage,
} from '../utils/image';
import { BrushCanvas, BrushCanvasHandle } from './BrushCanvas';

interface EraserPageProps {
  /** watermark=去水印(橙) object=智能消除(粉) */
  mode: 'watermark' | 'object';
  title: string;
  subtitle: string;
  bannerClass: string;
  maskColor: string;
  hint: string;
}

interface EditResponse {
  imageUrl?: string;
}

interface FetchImageResponse {
  dataUrl?: string;
}

/** 涂抹消除类工具共用页面（去水印 / 智能消除） */
export default function EraserPage({
  mode,
  title,
  subtitle,
  bannerClass,
  maskColor,
  hint,
}: EraserPageProps) {
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [brushSize, setBrushSize] = useState(24);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState('');
  const brushRef = useRef<BrushCanvasHandle>(null);

  const pickImage = async () => {
    try {
      const chosen = await chooseImage();
      if (!chosen) return;
      setImage(chosen);
      setResult('');
    } catch (err) {
      console.error(err);
    }
  };

  const process = async () => {
    if (!image) {
      Taro.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    if (!brushRef.current?.hasMask()) {
      Taro.showToast({ title: '请先涂抹需要消除的区域', icon: 'none' });
      return;
    }
    setProcessing(true);
    setResult('');
    Taro.showLoading({ title: 'AI 处理中，约 1 分钟…', mask: true });
    try {
      const composed = await brushRef.current.getComposedFile();
      if (!composed) throw new Error('蒙版合成失败');
      const imageBase64 = fileToDataUrl(composed, 'image/png');

      const data = await post<EditResponse>('/api/image-edit', {
        imageBase64,
        mode,
      });
      if (!data.imageUrl) throw new Error('未返回图片');
      const proxy = await post<FetchImageResponse>('/api/fetch-image', {
        url: data.imageUrl,
      });
      if (!proxy.dataUrl) throw new Error('结果加载失败');
      const path = await dataUrlToTempFile(proxy.dataUrl, 'jpeg');
      setResult(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '处理失败，请重试';
      Taro.showToast({ title: msg.slice(0, 28), icon: 'none', duration: 3000 });
    } finally {
      Taro.hideLoading();
      setProcessing(false);
    }
  };

  return (
    <View className="page">
      <View className={`banner ${bannerClass}`}>
        <Text className="banner__title">{title}</Text>
        <Text className="banner__desc">{subtitle}</Text>
      </View>

      {/* 选图 / 涂抹 */}
      <View className="card">
        <View className="card__label-row">
          <Text className="card__label">涂抹需要消除的区域</Text>
          {image && (
            <Text className="card__action" onClick={pickImage}>
              重新选图
            </Text>
          )}
        </View>
        {image ? (
          <BrushCanvas
            ref={brushRef}
            canvasId={`eraser-${mode}`}
            imagePath={image.filePath}
            imageWidth={image.width}
            imageHeight={image.height}
            maskColor={maskColor}
            brushSize={brushSize}
          />
        ) : (
          <View className="pick pick--empty" onClick={pickImage}>
            <Text className="pick__plus">＋</Text>
            <Text className="pick__hint">点击选择图片</Text>
          </View>
        )}
        <Text className="card__tip">{hint}</Text>
      </View>

      {image && (
        <View className="card">
          <View className="card__label-row">
            <Text className="card__label">笔刷大小</Text>
            <Text className="card__value">{brushSize}px</Text>
          </View>
          <Slider
            min={8}
            max={80}
            step={2}
            value={brushSize}
            activeColor={maskColor}
            onChange={(e) => setBrushSize(e.detail.value)}
          />
          <View className="row" style={{ marginTop: '20rpx' }}>
            <Button className="tool-btn" onClick={() => brushRef.current?.undo()}>
              撤销
            </Button>
            <Button className="tool-btn" onClick={() => brushRef.current?.clear()}>
              清空
            </Button>
          </View>
        </View>
      )}

      {/* 结果 */}
      {result && (
        <View className="card">
          <Text className="card__label">处理结果</Text>
          <Image
            className="result-img"
            src={result}
            mode="aspectFit"
            onClick={() => Taro.previewImage({ current: result, urls: [result] })}
          />
          <Button className="result__save" onClick={() => saveToAlbum(result)}>
            保存到相册
          </Button>
        </View>
      )}

      <View className="footer">
        <Button
          className={`footer__btn ${bannerClass} ${processing ? 'footer__btn--disabled' : ''}`}
          disabled={processing}
          onClick={process}
        >
          {processing ? '处理中…' : '开始处理'}
        </Button>
      </View>
      <View className="footer-placeholder" />
    </View>
  );
}

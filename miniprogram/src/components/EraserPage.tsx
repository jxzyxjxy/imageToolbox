import { useRef, useState } from 'react';
import { View, Text, Image, Slider, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { generateEdit } from '../api/client';
import { uploadImage, getTempUrls, downloadTemp } from '../api/cloud';
import { chooseImage, saveToAlbum, ChosenImage } from '../utils/image';
import { BrushCanvas, BrushCanvasHandle } from './BrushCanvas';
import ProcessPlaceholder from './ProcessPlaceholder';

interface EraserPageProps {
  /** watermark=去水印(橙) object=智能消除(粉) */
  mode: 'watermark' | 'object';
  title: string;
  subtitle: string;
  bannerClass: string;
  maskColor: string;
  hint: string;
}

interface ResultItem {
  fileID: string;
  url: string;
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
  const [result, setResult] = useState<ResultItem | null>(null);
  const brushRef = useRef<BrushCanvasHandle>(null);

  const pickImage = async () => {
    try {
      const chosen = await chooseImage({ secCheck: true });
      if (!chosen) return;
      setImage(chosen);
      setResult(null);
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
    setResult(null);
    try {
      const composed = await brushRef.current.getComposedFile();
      if (!composed) throw new Error('蒙版合成失败');

      const inputFileID = await uploadImage(composed);
      const data = await generateEdit(inputFileID, mode);
      const first = data.results?.[0];
      if (!first) throw new Error('未返回图片');
      const urlMap = await getTempUrls([first.fileID]);
      const url = urlMap.get(first.fileID);
      if (!url) throw new Error('结果加载失败');
      setResult({ fileID: first.fileID, url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '处理失败，请重试';
      Taro.showToast({ title: msg.slice(0, 28), icon: 'none', duration: 3000 });
    } finally {
      setProcessing(false);
    }
  };

  const saveResult = async () => {
    if (!result) return;
    try {
      Taro.showLoading({ title: '下载中…', mask: true });
      const path = await downloadTemp(result.fileID);
      await saveToAlbum(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '下载失败';
      Taro.showToast({ title: msg.slice(0, 20), icon: 'none' });
    } finally {
      Taro.hideLoading();
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

      {/* 结果：处理中显示占位动画 */}
      {(result || processing) && (
        <View className="card">
          <Text className="card__label">处理结果</Text>
          {processing ? (
            <ProcessPlaceholder
              title="AI 正在处理，请稍候…"
              desc="智能识别与填补还原需要十几秒，请勿退出页面"
            />
          ) : (
            result && (
              <>
                <Image
                  className="result-img"
                  src={result.url}
                  mode="aspectFit"
                  onClick={() =>
                    Taro.previewImage({ current: result.url, urls: [result.url] })
                  }
                />
                <Button className="result__save" onClick={saveResult}>
                  保存到相册
                </Button>
              </>
            )
          )}
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

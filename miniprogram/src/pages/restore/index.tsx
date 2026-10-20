import { useState } from 'react';
import { View, Text, Image, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { post } from '../../api/client';
import {
  chooseImage,
  dataUrlToTempFile,
  saveToAlbum,
  ChosenImage,
} from '../../utils/image';
import './index.scss';

interface EditResponse {
  imageUrl?: string;
}

interface FetchImageResponse {
  dataUrl?: string;
}

export default function Restore() {
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string>('');

  const pickImage = async () => {
    try {
      const chosen = await chooseImage({ secCheck: true });
      if (!chosen) return;
      setImage(chosen);
      setResult('');
    } catch (err) {
      console.error(err);
    }
  };

  const restore = async () => {
    if (!image) {
      Taro.showToast({ title: '请先选择照片', icon: 'none' });
      return;
    }
    setProcessing(true);
    setResult('');
    Taro.showLoading({ title: '修复中，约需 1 分钟…', mask: true });
    try {
      const data = await post<EditResponse>('/api/mp/image-edit', {
        imageBase64: image.dataUrl,
        mode: 'restore',
      });
      if (!data.imageUrl) throw new Error('未返回图片');
      // 远程 URL 走服务端代理转 dataURL，再写临时文件用于预览/保存
      const proxy = await post<FetchImageResponse>('/api/fetch-image', {
        url: data.imageUrl,
      });
      if (!proxy.dataUrl) throw new Error('结果加载失败');
      const path = await dataUrlToTempFile(proxy.dataUrl, 'jpeg');
      setResult(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '修复失败，请重试';
      Taro.showToast({ title: msg.slice(0, 28), icon: 'none', duration: 3000 });
    } finally {
      Taro.hideLoading();
      setProcessing(false);
    }
  };

  return (
    <View className="page">
      <View className="banner">
        <Text className="banner__title">AI 老照片修复</Text>
        <Text className="banner__desc">修复模糊、划痕、褪色，还原清晰记忆</Text>
      </View>

      {/* 选图 */}
      <View className="card">
        <Text className="card__label">原始照片</Text>
        {image ? (
          <View className="pick" onClick={pickImage}>
            <Image className="pick__img" src={image.filePath} mode="aspectFit" />
            <Text className="pick__size">
              {image.width}×{image.height}
            </Text>
          </View>
        ) : (
          <View className="pick pick--empty" onClick={pickImage}>
            <Text className="pick__plus">＋</Text>
            <Text className="pick__hint">点击选择老照片</Text>
          </View>
        )}
      </View>

      {/* 结果对比 */}
      {result && (
        <View className="card">
          <Text className="card__label">修复结果</Text>
          <View className="compare">
            <View className="compare__item">
              <Image
                className="compare__img"
                src={image!.filePath}
                mode="aspectFit"
              />
              <Text className="compare__cap">修复前</Text>
            </View>
            <View className="compare__item">
              <Image
                className="compare__img"
                src={result}
                mode="aspectFit"
                onClick={() =>
                  Taro.previewImage({ current: result, urls: [result] })
                }
              />
              <Text className="compare__cap compare__cap--ok">修复后</Text>
            </View>
          </View>
          <Button className="result__save" onClick={() => saveToAlbum(result)}>
            保存到相册
          </Button>
        </View>
      )}

      <View className="footer">
        <Button
          className={`footer__btn ${processing ? 'footer__btn--disabled' : ''}`}
          disabled={processing}
          onClick={restore}
        >
          {processing ? '修复中…' : '开始修复'}
        </Button>
      </View>
      <View className="footer-placeholder" />
    </View>
  );
}

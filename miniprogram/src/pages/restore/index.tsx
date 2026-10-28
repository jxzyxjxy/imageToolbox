import { useEffect, useState } from 'react';
import { View, Text, Image, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { generateEdit } from '../../api/client';
import { uploadImage, getTempUrls, downloadTemp } from '../../api/cloud';
import { chooseImage, saveToAlbum, ChosenImage } from '../../utils/image';
import ProcessPlaceholder from '../../components/ProcessPlaceholder';
import './index.scss';

export default function Restore() {
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ fileID: string; url: string } | null>(null);

  // 修复开始时自动滚动到结果区（占位区渲染后延迟一拍再滚）
  useEffect(() => {
    if (processing && !result) {
      const t = setTimeout(() => {
        Taro.pageScrollTo({ selector: '#restore-result', duration: 250 }).catch(() => {});
      }, 120);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing]);

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

  const restore = async () => {
    if (!image) {
      Taro.showToast({ title: '请先选择照片', icon: 'none' });
      return;
    }
    setProcessing(true);
    setResult(null);
    try {
      setUploading(true);
      const inputFileID = await uploadImage(image.filePath);
      setUploading(false);
      const data = await generateEdit(inputFileID, 'restore');
      const first = data.results?.[0];
      if (!first) throw new Error('未返回图片');
      const urlMap = await getTempUrls([first.fileID]);
      const url = urlMap.get(first.fileID);
      if (!url) throw new Error('结果加载失败');
      setResult({ fileID: first.fileID, url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '修复失败，请重试';
      Taro.showToast({ title: msg.slice(0, 28), icon: 'none', duration: 3000 });
    } finally {
      setUploading(false);
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

      {/* 结果对比：修复中显示占位动画（上传/修复分阶段文案） */}
      {(result || processing) && image && (
        <View className="card" id="restore-result">
          <Text className="card__label">修复结果</Text>
          {processing ? (
            <ProcessPlaceholder
              title={uploading ? '图片上传中…' : 'AI 正在修复照片…'}
              desc={
                uploading
                  ? '大图上传需要几秒，请保持网络畅通'
                  : '划痕修复与清晰度增强需要十几秒，请勿退出页面'
              }
            />
          ) : (
            result && (
              <>
                <View className="compare">
                  <View className="compare__item">
                    <Image
                      className="compare__img"
                      src={image.filePath}
                      mode="aspectFit"
                    />
                    <Text className="compare__cap">修复前</Text>
                  </View>
                  <View className="compare__item">
                    <Image
                      className="compare__img"
                      src={result.url}
                      mode="aspectFit"
                      onClick={() =>
                        Taro.previewImage({ current: result.url, urls: [result.url] })
                      }
                    />
                    <Text className="compare__cap compare__cap--ok">修复后</Text>
                  </View>
                </View>
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

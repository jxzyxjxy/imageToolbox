import { useEffect, useState } from 'react';
import { View, Text, Image, Input, Slider, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { generateSimilar } from '../../api/client';
import { uploadImage, getTempUrls, downloadTemp } from '../../api/cloud';
import { requestPortraitConsent, hasAgreed } from '../../utils/consent';
import ConsentCheckbox from '../../components/ConsentCheckbox';
import { chooseImage, saveToAlbum, formatSize, ChosenImage } from '../../utils/image';
import ProcessPlaceholder from '../../components/ProcessPlaceholder';
import './index.scss';

type ModelKey = 'seedream4' | 'seedream5flash';

const MODEL_OPTIONS: { key: ModelKey; name: string; desc: string; locked?: boolean }[] = [
  { key: 'seedream4', name: 'Seedream 4.0', desc: '稳定高质' },
  { key: 'seedream5flash', name: '5.0 Flash', desc: '新版快速', locked: true },
];

const BG_OPTIONS = [
  { key: 'normal', name: '默认氛围', desc: '自动补充光影背景' },
  { key: 'transparent', name: '透明背景', desc: '适合图标 / 按钮 PNG' },
];

const COUNTS = [1, 2, 4];

interface ResultItem {
  fileID: string;
  url: string;
}

export default function Similar() {
  // 肖像权授权门禁：授权通过前不渲染页面内容（防弹窗弹出前空窗期操作）
  const [authed, setAuthed] = useState(() => hasAgreed());
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [modelKey, setModelKey] = useState<ModelKey>('seedream4');
  const [bgMode, setBgMode] = useState<'normal' | 'transparent'>('normal');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [similarity, setSimilarity] = useState(70);
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<ResultItem[]>([]);

  // 生成开始时自动滚动到结果区（占位区渲染后延迟一拍再滚）
  useEffect(() => {
    if (generating) {
      const t = setTimeout(() => {
        Taro.pageScrollTo({ selector: '#similar-result', duration: 250 }).catch(() => {});
      }, 120);
      return () => clearTimeout(t);
    }
  }, [generating]);

  // 进入页面即确认肖像权授权：同意一次永久记住；拒绝则留在页面，主按钮置灰等待勾选
  useDidShow(() => {
    if (hasAgreed()) {
      setAuthed(true);
      return;
    }
    requestPortraitConsent(
      () => setAuthed(true),
      () => console.log('[consent] 首次弹窗被拒绝，按钮置灰等待勾选'),
    );
  });

  const pickImage = async () => {
    try {
      const chosen = await chooseImage({ secCheck: true });
      if (!chosen) return;
      setImage(chosen);
      setWidth(String(chosen.width));
      setHeight(String(chosen.height));
      setResults([]);
    } catch (err) {
      console.error(err);
    }
  };

  const applyOrigSize = () => {
    if (!image) return;
    setWidth(String(image.width));
    setHeight(String(image.height));
  };

  const generate = async () => {
    if (!authed) {
      Taro.showToast({ title: '请先勾选上方肖像权授权', icon: 'none' });
      return;
    }
    if (!image) {
      Taro.showToast({ title: '请先选择图片', icon: 'none' });
      return;
    }
    const w = parseInt(width, 10);
    const h = parseInt(height, 10);
    if (!w || !h || w <= 0 || h <= 0) {
      Taro.showToast({ title: '请输入有效尺寸', icon: 'none' });
      return;
    }
    setGenerating(true);
    setResults([]);
    try {
      // 1) 图片上传云存储（避免 callFunction 1MB 载荷限制）
      setUploading(true);
      const inputFileID = await uploadImage(image.filePath);
      setUploading(false);
      // 2) 云函数生图
      const data = await generateSimilar(inputFileID, {
        width: w,
        height: h,
        similarity,
        count,
        modelKey,
        transparent: bgMode === 'transparent',
      });
      if (!data.results?.length) throw new Error('未返回图片');
      // 3) fileID 换临时链接用于展示
      const urlMap = await getTempUrls(data.results.map((r) => r.fileID));
      const items = data.results
        .map((r) => ({ fileID: r.fileID, url: urlMap.get(r.fileID) || '' }))
        .filter((r) => r.url);
      if (items.length === 0) throw new Error('结果加载失败');
      setResults(items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败，请重试';
      Taro.showToast({ title: msg.slice(0, 28), icon: 'none', duration: 3000 });
    } finally {
      setUploading(false);
      setGenerating(false);
    }
  };

  const previewImage = (current: string) => {
    Taro.previewImage({ current, urls: results.map((r) => r.url) });
  };

  /** 保存前先下载到本地临时文件（saveImageToPhotosAlbum 不支持远程 URL） */
  const saveResult = async (item: ResultItem) => {
    try {
      Taro.showLoading({ title: '下载中…', mask: true });
      const path = await downloadTemp(item.fileID);
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
      {/* 标题卡 */}
      <View className="banner">
        <Text className="banner__title">AI 生成相似图</Text>
        <Text className="banner__desc">上传图片，生成风格一致的新图片</Text>
      </View>

      {/* 选图 */}
      <View className="card">
        <Text className="card__label">原始图片</Text>
        {image ? (
          <View className="pick" onClick={pickImage}>
            <Image className="pick__img" src={image.filePath} mode="aspectFit" />
            <View className="pick__meta">
              <Text className="pick__size">
                原图 {image.width}×{image.height} · {formatSize(image.size)}
              </Text>
              <Text className="pick__re">点击重新选择</Text>
            </View>
          </View>
        ) : (
          <View className="pick pick--empty" onClick={pickImage}>
            <Text className="pick__plus">＋</Text>
            <Text className="pick__hint">点击选择图片</Text>
          </View>
        )}
      </View>

      {/* 模型选择 */}
      <View className="card">
        <Text className="card__label">生成模型</Text>
        <View className="row">
          {MODEL_OPTIONS.map((m) => (
            <View
              key={m.key}
              className={`opt ${modelKey === m.key ? 'opt--active' : ''} ${m.locked ? 'opt--locked' : ''}`}
              onClick={() => {
                if (m.locked) {
                  Taro.showToast({ title: '5.0 Flash 暂未开放', icon: 'none' });
                  return;
                }
                setModelKey(m.key);
              }}
            >
              {!!m.locked && <Text className="opt__lock">即将开放</Text>}
              <Text className="opt__name">{m.name}</Text>
              <Text className="opt__desc">{m.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 背景选择 */}
      <View className="card">
        <Text className="card__label">背景模式</Text>
        <View className="row">
          {BG_OPTIONS.map((b) => (
            <View
              key={b.key}
              className={`opt ${bgMode === b.key ? 'opt--active' : ''}`}
              onClick={() => setBgMode(b.key as 'normal' | 'transparent')}
            >
              <Text className="opt__name">{b.name}</Text>
              <Text className="opt__desc">{b.desc}</Text>
            </View>
          ))}
        </View>
        {bgMode === 'transparent' && (
          <Text className="card__tip">输出 PNG，主体外区域自动透明</Text>
        )}
      </View>

      {/* 尺寸 */}
      <View className="card">
        <View className="card__label-row">
          <Text className="card__label">输出尺寸</Text>
          {image && (
            <Text className="card__action" onClick={applyOrigSize}>
              原图尺寸 {image.width}×{image.height}
            </Text>
          )}
        </View>
        <View className="size-row">
          <Input
            className="size-input"
            type="number"
            placeholder="宽"
            value={width}
            onInput={(e) => setWidth(e.detail.value)}
          />
          <Text className="size-x">×</Text>
          <Input
            className="size-input"
            type="number"
            placeholder="高"
            value={height}
            onInput={(e) => setHeight(e.detail.value)}
          />
        </View>
        <Text className="card__tip">单边 720~4096，比例将等比适配模型限制</Text>
      </View>

      {/* 相似度 */}
      <View className="card">
        <View className="card__label-row">
          <Text className="card__label">相似度</Text>
          <Text className="card__value">{similarity}%</Text>
        </View>
        <Slider
          min={10}
          max={100}
          step={5}
          value={similarity}
          activeColor="#6366f1"
          onChange={(e) => setSimilarity(e.detail.value)}
        />
        <Text className="card__tip">越高越接近原图，越低越有创意</Text>
      </View>

      {/* 张数 */}
      <View className="card">
        <Text className="card__label">生成张数</Text>
        <View className="row">
          {COUNTS.map((c) => (
            <View
              key={c}
              className={`chip ${count === c ? 'chip--active' : ''}`}
              onClick={() => setCount(c)}
            >
              <Text>{c} 张</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 结果：生成中显示占位动画（上传/生成分阶段文案） */}
      {(results.length > 0 || generating) && (
        <View className="card" id="similar-result">
          <Text className="card__label">
            {generating ? '生成结果' : '生成结果（点击预览，长按无效请用按钮保存）'}
          </Text>
          <Text className="ai-mark">AI生成</Text>
          {generating ? (
            <ProcessPlaceholder
              title={uploading ? '图片上传中…' : 'AI 正在生成相似图…'}
              desc={
                uploading
                  ? '大图上传需要几秒，请保持网络畅通'
                  : `本次生成 ${count} 张，大模型出图需要 20~40 秒，请勿退出页面`
              }
            />
          ) : (
            <View className={`results ${results.length === 1 ? 'results--single' : ''}`}>
              {results.map((r, i) => (
                <View key={i} className="results__item">
                  <Image
                    className="results__img"
                    src={r.url}
                    mode="aspectFit"
                    onClick={() => previewImage(r.url)}
                  />
                  <Button
                    className="results__save"
                    onClick={() => saveResult(r)}
                  >
                    保存
                  </Button>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* 底部生成按钮 */}
      <View className="footer">
        <ConsentCheckbox authed={authed} onGrant={() => setAuthed(true)} />
        <Button
          className={`footer__btn ${!authed || generating ? 'footer__btn--disabled' : ''}`}
          disabled={generating}
          onClick={generate}
        >
          {generating ? '生成中…' : '开始生成'}
        </Button>
      </View>
      <View className="footer-placeholder" />
    </View>
  );
}

import { useState } from 'react';
import { View, Text, Image, Slider, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { post } from '../../api/client';
import { chooseImage, dataUrlToTempFile, saveToAlbum, ChosenImage } from '../../utils/image';
import './index.scss';

interface IconItem {
  name: string;
  dataUrl: string;
  w: number;
  h: number;
}

interface SplitResponse {
  status: string;
  icons?: IconItem[];
  sprite?: string;
  spriteMeta?: { cols: number; rows: number; cellW: number; cellH: number };
  note?: string;
  error?: string;
}

const SIZES = [64, 128, 256, 512];
const COLS_OPTS = [
  { label: '自动', value: 0 },
  { label: '3 列', value: 3 },
  { label: '4 列', value: 4 },
  { label: '5 列', value: 5 },
];

interface IconView extends IconItem {
  filePath: string;
}

export default function IconSplitter() {
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [targetSize, setTargetSize] = useState(128);
  const [cols, setCols] = useState(0);
  const [gap, setGap] = useState(0);
  const [icons, setIcons] = useState<IconView[]>([]);
  const [sprite, setSprite] = useState('');
  const [spriteMeta, setSpriteMeta] = useState<SplitResponse['spriteMeta']>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingAll, setSavingAll] = useState(false);

  const pickImage = async () => {
    try {
      const chosen = await chooseImage();
      if (!chosen) return;
      setImage(chosen);
      setIcons([]);
      setSprite('');
      setNote('');
    } catch (err) {
      console.error(err);
    }
  };

  const run = async () => {
    if (!image || busy) return;
    setBusy(true);
    setIcons([]);
    setSprite('');
    Taro.showLoading({ title: '正在拆分…', mask: true });
    try {
      const data = await post<SplitResponse>('/api/split-icons', {
        imageBase64: image.dataUrl,
        targetSize,
        cols,
        gap,
      });
      setNote(data.note || '');
      const list = data.icons || [];
      const views: IconView[] = [];
      for (const icon of list) {
        const filePath = await dataUrlToTempFile(icon.dataUrl);
        views.push({ ...icon, filePath });
      }
      setIcons(views);
      if (data.sprite) {
        setSprite(await dataUrlToTempFile(data.sprite));
        setSpriteMeta(data.spriteMeta);
      }
      if (!views.length) {
        Taro.showToast({ title: '未识别到图标', icon: 'none' });
      }
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : '拆分失败',
        icon: 'none',
      });
    } finally {
      Taro.hideLoading();
      setBusy(false);
    }
  };

  const saveAll = async () => {
    if (savingAll) return;
    setSavingAll(true);
    let ok = 0;
    for (const icon of icons) {
      try {
        await saveToAlbum(icon.filePath);
        ok += 1;
      } catch {
        // 用户取消授权则中断
        break;
      }
    }
    setSavingAll(false);
    Taro.showToast({ title: `已保存 ${ok}/${icons.length}`, icon: 'none' });
  };

  return (
    <View className="page">
      <View className="banner">
        <Text className="banner__title">图标拆分 · 雪碧图</Text>
        <Text className="banner__desc">上传图标合集，自动拆成单个透明 PNG</Text>
      </View>

      {/* 选图 */}
      <View className="card">
        <View className="card__label-row">
          <Text className="card__label">合集图片</Text>
          {image && (
            <Text className="card__action" onClick={pickImage}>
              重新选图
            </Text>
          )}
        </View>
        {image ? (
          <Image className="pick__img" src={image.filePath} mode="aspectFit" />
        ) : (
          <View className="pick pick--empty" onClick={pickImage}>
            <Text className="pick__plus">＋</Text>
            <Text className="pick__hint">点击选择合集图片</Text>
          </View>
        )}
      </View>

      {image && (
        <>
          {/* 目标尺寸 */}
          <View className="card">
            <Text className="card__label">导出尺寸</Text>
            <View className="row">
              {SIZES.map((s) => (
                <View
                  key={s}
                  className={`chip ${targetSize === s ? 'chip--active' : ''}`}
                  onClick={() => setTargetSize(s)}
                >
                  <Text>{s}px</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 列数 + 空隙 */}
          <View className="card">
            <Text className="card__label">网格列数</Text>
            <View className="row">
              {COLS_OPTS.map((c) => (
                <View
                  key={c.value}
                  className={`chip ${cols === c.value ? 'chip--active' : ''}`}
                  onClick={() => setCols(c.value)}
                >
                  <Text>{c.label}</Text>
                </View>
              ))}
            </View>
            <View className="card__label-row" style={{ marginTop: '28rpx' }}>
              <Text className="card__label">图标间空隙</Text>
              <Text className="card__value">{gap}px</Text>
            </View>
            <Slider
              min={0}
              max={20}
              step={1}
              value={gap}
              activeColor="#a855f7"
              onChange={(e) => setGap(e.detail.value)}
            />
          </View>
        </>
      )}

      {/* 结果 */}
      {icons.length > 0 && (
        <View className="card">
          <View className="card__label-row">
            <Text className="card__label">拆出 {icons.length} 个图标</Text>
            <Text className="card__action" onClick={saveAll}>
              {savingAll ? '保存中…' : '保存全部'}
            </Text>
          </View>
          <View className="grid">
            {icons.map((icon) => (
              <View key={icon.name} className="grid__cell">
                <Image
                  className="grid__img"
                  src={icon.filePath}
                  mode="aspectFit"
                  onClick={() =>
                    Taro.previewImage({
                      current: icon.filePath,
                      urls: icons.map((i) => i.filePath),
                    })
                  }
                />
                <Text className="grid__save" onClick={() => saveToAlbum(icon.filePath)}>
                  保存
                </Text>
              </View>
            ))}
          </View>
          {!!note && <Text className="card__tip">{note}</Text>}
        </View>
      )}

      {/* 雪碧图 */}
      {sprite && (
        <View className="card">
          <Text className="card__label">
            雪碧图
            {spriteMeta
              ? `（${spriteMeta.cols}列 × ${spriteMeta.rows}行，单元 ${spriteMeta.cellW}×${spriteMeta.cellH}）`
              : ''}
          </Text>
          <View className="checker">
            <Image className="sprite" src={sprite} mode="widthFix" />
          </View>
          <Button className="result__save" onClick={() => saveToAlbum(sprite)}>
            保存雪碧图
          </Button>
        </View>
      )}

      <View className="footer">
        <Button
          className={`footer__btn ${busy ? 'footer__btn--disabled' : ''}`}
          disabled={busy}
          onClick={() => {
            if (!image) {
              pickImage();
            } else {
              run();
            }
          }}
        >
          {busy ? '拆分中…' : image ? '开始拆分' : '选择图片开始'}
        </Button>
      </View>
      <View className="footer-placeholder" />
    </View>
  );
}

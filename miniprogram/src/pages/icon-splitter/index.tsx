import { useState } from 'react';
import { View, Text, Image, Slider, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { splitIcons } from '../../api/client';
import { uploadImage, getTempUrls, downloadTemp } from '../../api/cloud';
import { chooseImage, saveToAlbum, ChosenImage } from '../../utils/image';
import ProcessPlaceholder from '../../components/ProcessPlaceholder';
import './index.scss';

interface IconView {
  name: string;
  fileID: string;
  url: string;
  w: number;
  h: number;
}

type SpriteMeta = { cols: number; rows: number; cellW: number; cellH: number };

const SIZES = [64, 128, 256, 512];
const COLS_OPTS = [
  { label: '自动', value: 0 },
  { label: '3 列', value: 3 },
  { label: '4 列', value: 4 },
  { label: '5 列', value: 5 },
];

export default function IconSplitter() {
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [targetSize, setTargetSize] = useState(128);
  const [cols, setCols] = useState(0);
  const [gap, setGap] = useState(0);
  const [icons, setIcons] = useState<IconView[]>([]);
  const [sprite, setSprite] = useState<{ fileID: string; url: string } | null>(null);
  const [spriteMeta, setSpriteMeta] = useState<SpriteMeta>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingAll, setSavingAll] = useState(false);

  const pickImage = async () => {
    try {
      const chosen = await chooseImage({ secCheck: true });
      if (!chosen) return;
      setImage(chosen);
      setIcons([]);
      setSprite(null);
      setNote('');
    } catch (err) {
      console.error(err);
    }
  };

  const run = async () => {
    if (!image || busy) return;
    setBusy(true);
    setIcons([]);
    setSprite(null);
    try {
      const inputFileID = await uploadImage(image.filePath);
      const data = await splitIcons(inputFileID, { targetSize, cols, gap });
      setNote(data.note || '');
      const list = data.icons || [];

      const fileIDs = list.map((i) => i.fileID);
      if (data.spriteFileID) fileIDs.push(data.spriteFileID);
      const urlMap = await getTempUrls(fileIDs);

      const views: IconView[] = list.map((icon) => ({
        ...icon,
        url: urlMap.get(icon.fileID) || '',
      }));
      setIcons(views);
      if (data.spriteFileID) {
        setSprite({
          fileID: data.spriteFileID,
          url: urlMap.get(data.spriteFileID) || '',
        });
        setSpriteMeta(data.spriteMeta);
      }
      if (!views.length) {
        Taro.showToast({ title: '未识别到图标', icon: 'none' });
      }
    } catch (err) {
      Taro.showToast({
        title: (err instanceof Error ? err.message : '拆分失败').slice(0, 28),
        icon: 'none',
      });
    } finally {
      setBusy(false);
    }
  };

  /** 云端图标需先下载再保存相册 */
  const saveIcon = async (icon: IconView) => {
    try {
      const path = await downloadTemp(icon.fileID);
      await saveToAlbum(path);
    } catch {
      /* 用户取消或失败，saveToAlbum 已提示 */
    }
  };

  const saveSprite = async () => {
    if (!sprite) return;
    try {
      const path = await downloadTemp(sprite.fileID);
      await saveToAlbum(path);
    } catch {
      /* 同上 */
    }
  };

  const saveAll = async () => {
    if (savingAll) return;
    setSavingAll(true);
    let ok = 0;
    for (const icon of icons) {
      try {
        const path = await downloadTemp(icon.fileID);
        await saveToAlbum(path);
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

      {/* 结果：拆分中显示占位动画 */}
      {busy && (
        <View className="card">
          <Text className="card__label">拆分结果</Text>
          <ProcessPlaceholder
            title="正在拆分图标…"
            desc="云端识别与切分需要几秒钟，请勿退出页面"
          />
        </View>
      )}
      {!busy && icons.length > 0 && (
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
                  src={icon.url}
                  mode="aspectFit"
                  onClick={() =>
                    Taro.previewImage({
                      current: icon.url,
                      urls: icons.map((i) => i.url),
                    })
                  }
                />
                <Text className="grid__save" onClick={() => saveIcon(icon)}>
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
            <Image className="sprite" src={sprite.url} mode="widthFix" />
          </View>
          <Button className="result__save" onClick={saveSprite}>
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

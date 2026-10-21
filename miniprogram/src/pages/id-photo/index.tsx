import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Canvas, Slider, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { segmentImage } from '../../api/client';
import { uploadImage, downloadTemp } from '../../api/cloud';
import { chooseImage, saveToAlbum, ChosenImage } from '../../utils/image';
import {
  canvasToTempFile,
  fitSize,
  getCanvas,
  getSubjectBBoxFromData,
  loadCanvasImage,
  removeBackgroundPixels,
  sampleCornerColorFromData,
} from '../../utils/canvas';
import './index.scss';

const PROC_MAX_DIM = 1024;

interface IdSpec {
  id: string;
  name: string;
  mm: string;
  w: number;
  h: number;
}

const SPECS: IdSpec[] = [
  { id: '1inch', name: '一寸', mm: '25×35mm', w: 295, h: 413 },
  { id: '2inch', name: '二寸', mm: '35×49mm', w: 413, h: 579 },
  { id: 'small1', name: '小一寸', mm: '22×32mm', w: 260, h: 378 },
  { id: 'big1', name: '大一寸', mm: '33×48mm', w: 390, h: 567 },
  { id: 'small2', name: '小二寸', mm: '35×45mm', w: 413, h: 531 },
];

const BG_COLORS: { name: string; value: string }[] = [
  { name: '白', value: '#ffffff' },
  { name: '红', value: '#d9261c' },
  { name: '浅蓝', value: '#7fb3e6' },
  { name: '标准蓝', value: '#2d6bb3' },
  { name: '深蓝', value: '#1e4e8c' },
  { name: '灰', value: '#c8ccd4' },
];

/** 在离屏 canvas 上采样照片四角的平均背景色（不依赖 AI） */
async function sampleLocalCorner(
  chosen: ChosenImage,
): Promise<[number, number, number]> {
  const size = fitSize(chosen.width, chosen.height, PROC_MAX_DIM);
  const c = await getCanvas('idp-sample');
  c.width = size.w;
  c.height = size.h;
  const ctx = c.getContext('2d');
  const img = await loadCanvasImage(c, chosen.filePath);
  ctx.drawImage(img as unknown as never, 0, 0, size.w, size.h);
  const data = ctx.getImageData(0, 0, size.w, size.h).data;
  return sampleCornerColorFromData(data, size.w, size.h);
}

export default function IdPhoto() {
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [refColor, setRefColor] = useState<[number, number, number]>([245, 245, 245]);
  const [tolerance, setTolerance] = useState(16);
  const [bgColor, setBgColor] = useState('#2d6bb3');
  const [spec, setSpec] = useState<IdSpec>(SPECS[0]);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  // AI 分割结果（透明背景人像临时文件），存在时跳过本地泛洪抠图
  const [aiSeg, setAiSeg] = useState<string | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generate = useCallback(
    async (
      img: ChosenImage,
      ref: [number, number, number],
      tol: number,
      bg: string,
      sp: IdSpec,
      seg: string | null,
    ) => {
      setBusy(true);
      try {
        // 1. 得到透明人像画布：AI 分割结果 或 本地泛洪抠图
        const size = fitSize(img.width, img.height, PROC_MAX_DIM);
        const subject = await getCanvas('idp-subject');
        subject.width = size.w;
        subject.height = size.h;
        const sctx = subject.getContext('2d');
        const bitmap = await loadCanvasImage(subject, seg || img.filePath);
        sctx.clearRect(0, 0, size.w, size.h);
        sctx.drawImage(bitmap as unknown as never, 0, 0, size.w, size.h);
        const imageData = sctx.getImageData(0, 0, size.w, size.h);
        const bbox = seg
          ? getSubjectBBoxFromData(imageData.data, size.w, size.h)
          : removeBackgroundPixels(imageData.data, size.w, size.h, ref, tol);
        sctx.putImageData(imageData, 0, 0);

        // 2. 合成证件照（人像 82% + 头顶留白 10%，与 H5 一致）
        const out = await getCanvas('idp-out');
        out.width = sp.w;
        out.height = sp.h;
        const octx = out.getContext('2d');
        octx.fillStyle = bg;
        octx.fillRect(0, 0, sp.w, sp.h);

        if (bbox.w > 0 && bbox.h > 0) {
          // 证件照构图：整图等比缩放，人像约占 82%，水平居中；
          // 人物底部贴照片底边（微超 1%，胸口自然裁切），头顶留白自然形成，避免底部悬空
          const cx = bbox.x + bbox.w / 2;
          const scale = Math.max(sp.w / bbox.w, sp.h / bbox.h) * 0.82;
          const dw = size.w * scale;
          const dh = size.h * scale;
          const dx = sp.w / 2 - cx * scale;
          const dy = sp.h * 1.01 - (bbox.y + bbox.h) * scale;
          octx.drawImage(subject as unknown as never, dx, dy, dw, dh);
        } else {
          // 兜底：contain 等比适配，绝不拉伸变形
          const scale = Math.min(sp.w / size.w, sp.h / size.h);
          const dw = size.w * scale;
          const dh = size.h * scale;
          octx.drawImage(
            subject as unknown as never,
            (sp.w - dw) / 2,
            (sp.h - dh) / 2,
            dw,
            dh,
          );
        }

        const path = await canvasToTempFile(out, { fileType: 'jpg', quality: 0.95 });
        setResult(path);
      } catch (err) {
        console.error(err);
        Taro.showToast({ title: '生成失败，请重试', icon: 'none' });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const pickImage = async () => {
    try {
      const chosen = await chooseImage({ secCheck: true });
      if (!chosen) return;
      setImage(chosen);
      setResult('');
      setTolerance(16);
      setNote('');
      setAiSeg(null);

      // 1. 优先：云函数 AI 人像分割（发丝级，适配复杂背景）
      setSegmenting(true);
      setNote('AI 抠图中，复杂背景也能自动去除…');
      try {
        const inputFileID = await uploadImage(chosen.filePath);
        const res = await segmentImage(inputFileID);
        if (!res.fileID) throw new Error(res.error || 'AI 抠图失败');
        const segPath = await downloadTemp(res.fileID);
        setAiSeg(segPath);
        setSegmenting(false);
        setNote('AI 已自动去除背景，直接选背景色与规格即可');
        await generate(chosen, refColor, 16, bgColor, spec, segPath);
        return;
      } catch {
        setSegmenting(false);
        setNote('AI 抠图不可用，已切换本地抠图模式');
      }

      // 2. 兜底：本地采样四角背景色 + 泛洪抠图
      const bg = await sampleLocalCorner(chosen);
      setRefColor(bg);
      setNote('已使用照片背景色，可拖动容差优化抠图');
      await generate(chosen, bg, 16, bgColor, spec, null);
    } catch (err) {
      console.error(err);
    }
  };

  // 参数变化：防抖重新生成
  useEffect(() => {
    if (!image) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      generate(image, refColor, tolerance, bgColor, spec, aiSeg);
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tolerance, bgColor, spec, aiSeg]);

  return (
    <View className="page">
      <View className="banner">
        <Text className="banner__title">标准证件照，即时生成</Text>
        <Text className="banner__desc">自由选择背景色与尺寸规格</Text>
      </View>

      {/* 选图 */}
      <View className="card">
        <View className="card__label-row">
          <Text className="card__label">原始照片</Text>
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
            <Text className="pick__hint">点击选择半身照片</Text>
          </View>
        )}
        {segmenting && <Text className="card__tip">AI 抠图中，发丝级分割需要几秒钟…</Text>}
        {!!note && !segmenting && <Text className="card__tip">{note}</Text>}
      </View>

      {image && (
        <>
          {/* 背景色 */}
          <View className="card">
            <Text className="card__label">证件照背景色</Text>
            <View className="colors">
              {BG_COLORS.map((c) => (
                <View
                  key={c.value}
                  className={`colors__item ${bgColor === c.value ? 'colors__item--active' : ''}`}
                  onClick={() => setBgColor(c.value)}
                >
                  <View className="colors__dot" style={{ background: c.value }} />
                  <Text className="colors__name">{c.name}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 规格 */}
          <View className="card">
            <Text className="card__label">尺寸规格</Text>
            <View className="specs">
              {SPECS.map((s) => (
                <View
                  key={s.id}
                  className={`specs__item ${spec.id === s.id ? 'specs__item--active' : ''}`}
                  onClick={() => setSpec(s)}
                >
                  <Text className="specs__name">{s.name}</Text>
                  <Text className="specs__mm">{s.mm}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 容差（AI 抠图模式下无需调节） */}
          {!aiSeg && (
            <View className="card">
              <View className="card__label-row">
                <Text className="card__label">抠图容差</Text>
                <Text className="card__value">{tolerance}</Text>
              </View>
              <Slider
                min={2}
                max={60}
                step={1}
                value={tolerance}
                activeColor="#0ea5e9"
                onChange={(e) => setTolerance(e.detail.value)}
              />
              <Text className="card__tip">背景残留就调大，头发/衣服被误删就调小</Text>
            </View>
          )}
        </>
      )}

      {/* 结果 */}
      {result && (
        <View className="card">
          <Text className="card__label">
            {spec.name} {spec.w}×{spec.h}px{busy ? '（生成中…）' : ''}
          </Text>
          <View className="photo-wrap">
            <Image className="photo" src={result} mode="aspectFit" />
          </View>
          <Button className="result__save" onClick={() => saveToAlbum(result)}>
            保存到相册
          </Button>
        </View>
      )}

      <View className="footer">
        <Button
          className={`footer__btn ${busy ? 'footer__btn--disabled' : ''}`}
          disabled={busy}
          onClick={pickImage}
        >
          {image ? '换一张照片' : '选择照片开始'}
        </Button>
      </View>
      <View className="footer-placeholder" />

      {/* 隐藏画布 */}
      <Canvas
        type="2d"
        id="idp-sample"
        style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: '10px', height: '10px' }}
      />
      <Canvas
        type="2d"
        id="idp-subject"
        style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: '10px', height: '10px' }}
      />
      <Canvas
        type="2d"
        id="idp-out"
        style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: '10px', height: '10px' }}
      />
    </View>
  );
}

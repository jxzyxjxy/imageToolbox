import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Canvas, Slider, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { post } from '../../api/client';
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

interface AnalyzeResponse {
  bg: [number, number, number];
  uniform: boolean;
  confidence?: number;
  note?: string;
}

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
  const [analyzing, setAnalyzing] = useState(false);
  const [note, setNote] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generate = useCallback(
    async (
      img: ChosenImage,
      ref: [number, number, number],
      tol: number,
      bg: string,
      sp: IdSpec,
    ) => {
      setBusy(true);
      try {
        // 1. 处理副本上泛洪抠图
        const size = fitSize(img.width, img.height, PROC_MAX_DIM);
        const subject = await getCanvas('idp-subject');
        subject.width = size.w;
        subject.height = size.h;
        const sctx = subject.getContext('2d');
        const bitmap = await loadCanvasImage(subject, img.filePath);
        sctx.clearRect(0, 0, size.w, size.h);
        sctx.drawImage(bitmap as unknown as never, 0, 0, size.w, size.h);
        const imageData = sctx.getImageData(0, 0, size.w, size.h);
        const bbox = removeBackgroundPixels(imageData.data, size.w, size.h, ref, tol);
        sctx.putImageData(imageData, 0, 0);

        // 2. 合成证件照（cover 适配 + 重心上移，与 H5 一致）
        const out = await getCanvas('idp-out');
        out.width = sp.w;
        out.height = sp.h;
        const octx = out.getContext('2d');
        octx.fillStyle = bg;
        octx.fillRect(0, 0, sp.w, sp.h);

        if (bbox.w > 0 && bbox.h > 0) {
          // 整图等比缩放，bbox 中心锚定输出中心并上移 4%（与 H5 视觉等价，避免变形）
          const cx = bbox.x + bbox.w / 2;
          const cy = bbox.y + bbox.h / 2;
          const scale = Math.max(sp.w / bbox.w, sp.h / bbox.h);
          const dw = size.w * scale;
          const dh = size.h * scale;
          const dx = sp.w / 2 - cx * scale;
          const dy = sp.h / 2 - cy * scale - sp.h * 0.04;
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
      const chosen = await chooseImage();
      if (!chosen) return;
      setImage(chosen);
      setResult('');
      setTolerance(16);
      setNote('');

      // 1. 先本地采样四角背景色（可靠，不依赖任何 AI）
      let bg = await sampleLocalCorner(chosen);
      setRefColor(bg);
      await generate(chosen, bg, 16, bgColor, spec);

      // 2. 再尝试 AI 增强分析，仅在高置信度时覆盖本地采样
      setAnalyzing(true);
      try {
        const res = await post<AnalyzeResponse>('/api/analyze', {
          imageBase64: chosen.dataUrl,
        });
        if (
          Array.isArray(res.bg) &&
          res.bg.length === 3 &&
          (res.confidence === undefined || res.confidence >= 0.6)
        ) {
          bg = res.bg;
          setRefColor(bg);
          setNote('AI 已识别背景色');
        } else {
          setNote('已使用照片背景色，可拖动容差优化抠图');
        }
      } catch {
        setNote('AI 分析暂不可用，已使用照片背景色，可调容差优化');
      } finally {
        setAnalyzing(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 参数变化：防抖重新生成
  useEffect(() => {
    if (!image) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      generate(image, refColor, tolerance, bgColor, spec);
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tolerance, bgColor, spec]);

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
        {analyzing && <Text className="card__tip">AI 正在分析背景…</Text>}
        {!!note && !analyzing && <Text className="card__tip">{note}</Text>}
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

          {/* 容差 */}
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

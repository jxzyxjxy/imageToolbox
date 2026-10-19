import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Canvas, Slider, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { post } from '../../api/client';
import { chooseImage, saveToAlbum, ChosenImage } from '../../utils/image';
import {
  canvasToTempFile,
  fitSize,
  getCanvas,
  loadCanvasImage,
  removeBackgroundPixels,
  sampleCornerColorFromData,
} from '../../utils/canvas';
import './index.scss';

/** 处理副本最长边（像素级处理，兼顾内存与效果） */
const PROC_MAX_DIM = 1024;

interface AnalyzeResponse {
  bg: [number, number, number];
  uniform: boolean;
  confidence?: number;
  note?: string;
}

/** 本地采样四角平均背景色（不依赖 AI，与证件照页一致） */
async function sampleLocalCorner(
  chosen: ChosenImage,
): Promise<[number, number, number]> {
  const size = fitSize(chosen.width, chosen.height, PROC_MAX_DIM);
  const c = await getCanvas('rmbg-sample');
  c.width = size.w;
  c.height = size.h;
  const ctx = c.getContext('2d');
  const img = await loadCanvasImage(c, chosen.filePath);
  ctx.drawImage(img as unknown as never, 0, 0, size.w, size.h);
  const data = ctx.getImageData(0, 0, size.w, size.h).data;
  return sampleCornerColorFromData(data, size.w, size.h);
}

export default function RemoveBg() {
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [refColor, setRefColor] = useState<[number, number, number]>([245, 245, 245]);
  const [tolerance, setTolerance] = useState(16);
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runCutout = useCallback(
    async (img: ChosenImage, ref: [number, number, number], tol: number) => {
      setBusy(true);
      try {
        const size = fitSize(img.width, img.height, PROC_MAX_DIM);
        const canvas = await getCanvas('rmbg-proc');
        canvas.width = size.w;
        canvas.height = size.h;
        const ctx = canvas.getContext('2d');
        const bitmap = await loadCanvasImage(canvas, img.filePath);
        ctx.clearRect(0, 0, size.w, size.h);
        ctx.drawImage(bitmap as unknown as never, 0, 0, size.w, size.h);

        const imageData = ctx.getImageData(0, 0, size.w, size.h);
        removeBackgroundPixels(imageData.data, size.w, size.h, ref, tol);
        ctx.putImageData(imageData, 0, 0);

        const path = await canvasToTempFile(canvas, { fileType: 'png' });
        setResult(path);
      } catch (err) {
        console.error(err);
        Taro.showToast({ title: '抠图失败，请重试', icon: 'none' });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const analyze = useCallback(
    async (img: ChosenImage) => {
      setAnalyzing(true);
      setNote('');
      try {
        const res = await post<AnalyzeResponse>('/api/analyze', {
          imageBase64: img.dataUrl,
        });
        // 仅在高置信度时覆盖本地采样；兜底灰色（confidence=0.3）直接忽略
        if (
          Array.isArray(res.bg) &&
          res.bg.length === 3 &&
          (res.confidence === undefined || res.confidence >= 0.6)
        ) {
          setRefColor(res.bg);
          setNote('AI 已识别背景色');
          return res.bg;
        }
        setNote('已使用照片背景色，可拖动容差优化抠图');
      } catch {
        setNote('AI 分析暂不可用，已使用照片背景色，可调容差优化效果');
      } finally {
        setAnalyzing(false);
      }
      return null;
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
      // 先本地采样立即出图，再异步 AI 增强
      const localBg = await sampleLocalCorner(chosen);
      setRefColor(localBg);
      await runCutout(chosen, localBg, 16);
      const aiBg = await analyze(chosen);
      if (aiBg) await runCutout(chosen, aiBg, 16);
    } catch (err) {
      console.error(err);
    }
  };

  // 容差变化：防抖重算
  useEffect(() => {
    if (!image) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      runCutout(image, refColor, tolerance);
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tolerance]);

  return (
    <View className="page">
      <View className="banner">
        <Text className="banner__title">AI 智能抠图</Text>
        <Text className="banner__desc">一键去除背景，导出透明 PNG</Text>
      </View>

      {/* 选图 */}
      <View className="card">
        <View className="card__label-row">
          <Text className="card__label">原始图片</Text>
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
            <Text className="pick__hint">点击选择图片</Text>
          </View>
        )}
        {analyzing && <Text className="card__tip">AI 正在分析背景色…</Text>}
        {!!note && !analyzing && <Text className="card__tip">{note}</Text>}
      </View>

      {/* 容差 */}
      {image && (
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
            activeColor="#8b5cf6"
            onChange={(e) => setTolerance(e.detail.value)}
          />
          <Text className="card__tip">
            背景残留就调大，主体被误删就调小（适合背景较纯的图片）
          </Text>
        </View>
      )}

      {/* 结果 */}
      {result && (
        <View className="card">
          <Text className="card__label">抠图结果{busy ? '（处理中…）' : ''}</Text>
          <View className="checker">
            <Image className="checker__img" src={result} mode="aspectFit" />
          </View>
          <Button className="result__save" onClick={() => saveToAlbum(result)}>
            保存透明 PNG 到相册
          </Button>
        </View>
      )}

      <View className="footer">
        <Button
          className={`footer__btn ${busy ? 'footer__btn--disabled' : ''}`}
          disabled={busy}
          onClick={pickImage}
        >
          {image ? '换一张图片' : '选择图片开始'}
        </Button>
      </View>
      <View className="footer-placeholder" />

      {/* 隐藏采样画布 */}
      <Canvas
        type="2d"
        id="rmbg-sample"
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          width: '10px',
          height: '10px',
        }}
      />
      {/* 隐藏处理画布 */}
      <Canvas
        type="2d"
        id="rmbg-proc"
        style={{
          position: 'fixed',
          left: '-9999px',
          top: '-9999px',
          width: '10px',
          height: '10px',
        }}
      />
    </View>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Canvas, Slider, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { segmentImage } from '../../api/client';
import { uploadImage, downloadTemp } from '../../api/cloud';
import { requestPortraitConsent, hasAgreed } from '../../utils/consent';
import ConsentCheckbox from '../../components/ConsentCheckbox';
import { chooseImage, saveToAlbum, ChosenImage } from '../../utils/image';
import {
  canvasToTempFile,
  fitSize,
  getCanvas,
  loadCanvasImage,
  removeBackgroundPixels,
  sampleCornerColorFromData,
} from '../../utils/canvas';
import ProcessPlaceholder from '../../components/ProcessPlaceholder';
import './index.scss';

/** 处理副本最长边（像素级处理，兼顾内存与效果） */
const PROC_MAX_DIM = 1024;

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
  // 肖像权授权门禁：授权通过前不渲染页面内容（防弹窗弹出前空窗期操作）
  const [authed, setAuthed] = useState(() => hasAgreed());
  const [image, setImage] = useState<ChosenImage | null>(null);
  const [refColor, setRefColor] = useState<[number, number, number]>([245, 245, 245]);
  const [tolerance, setTolerance] = useState(16);
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  // AI 分割结果（透明背景临时文件），存在时跳过本地泛洪抠图
  const [aiSeg, setAiSeg] = useState<string | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 抠图开始时自动滚动到结果区（占位区渲染后延迟一拍再滚）
  useEffect(() => {
    if ((segmenting || busy) && !result) {
      const t = setTimeout(() => {
        Taro.pageScrollTo({ selector: '#rmbg-result', duration: 250 }).catch(() => {});
      }, 120);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmenting, busy]);

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

  const runCutout = useCallback(
    async (
      img: ChosenImage,
      ref: [number, number, number],
      tol: number,
      seg: string | null = null,
    ) => {
      setBusy(true);
      try {
        const size = fitSize(img.width, img.height, PROC_MAX_DIM);
        const canvas = await getCanvas('rmbg-proc');
        canvas.width = size.w;
        canvas.height = size.h;
        const ctx = canvas.getContext('2d');
        const bitmap = await loadCanvasImage(canvas, seg || img.filePath);
        ctx.clearRect(0, 0, size.w, size.h);
        ctx.drawImage(bitmap as unknown as never, 0, 0, size.w, size.h);

        if (!seg) {
          const imageData = ctx.getImageData(0, 0, size.w, size.h);
          removeBackgroundPixels(imageData.data, size.w, size.h, ref, tol);
          ctx.putImageData(imageData, 0, 0);
        }

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

  const pickImage = async () => {
    // 本页选图即上传 AI 分割：未授权时拦截（选图区/重新选图/底部按钮统一走这里）
    if (!authed) {
      Taro.showToast({ title: '请先勾选上方肖像权授权', icon: 'none' });
      return;
    }
    try {
      const chosen = await chooseImage({ secCheck: true });
      if (!chosen) return;
      setImage(chosen);
      setResult('');
      setTolerance(16);
      setNote('');
      setAiSeg(null);

      // 1. 优先：云函数 AI 主体分割（发丝级，适配复杂背景）
      setSegmenting(true);
      setUploading(true);
      setNote('图片上传中…');
      try {
        const inputFileID = await uploadImage(chosen.filePath);
        setUploading(false);
        setNote('AI 抠图中，复杂背景也能自动去除…');
        const res = await segmentImage(inputFileID);
        if (!res.fileID) throw new Error(res.error || 'AI 抠图失败');
        const segPath = await downloadTemp(res.fileID);
        setAiSeg(segPath);
        setSegmenting(false);
        setNote('AI 已自动去除背景，可直接保存');
        await runCutout(chosen, refColor, 16, segPath);
        return;
      } catch {
        setUploading(false);
        setSegmenting(false);
        setNote('AI 抠图不可用，已切换本地模式');
      }

      // 2. 兜底：本地采样背景色 + 泛洪抠图（适合纯色背景）
      const localBg = await sampleLocalCorner(chosen);
      setRefColor(localBg);
      setNote('已使用照片背景色，可拖动容差优化抠图');
      await runCutout(chosen, localBg, 16);
    } catch (err) {
      console.error(err);
    }
  };

  // 容差变化：防抖重算
  useEffect(() => {
    if (!image) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      runCutout(image, refColor, tolerance, aiSeg);
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tolerance, aiSeg]);

  return (
    <View className="page">
      <View className="banner">
        <Text className="banner__title">AI 智能抠图</Text>
        <Text className="banner__desc">一键去除背景，导出透明 PNG</Text>
        <View className="banner__ai">
          <Text className="banner__ai-badge">AI生成</Text>
          <Text className="banner__ai-text">本工具生成内容由人工智能生成</Text>
        </View>
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
        {segmenting && <Text className="card__tip">AI 抠图中，发丝级分割需要几秒钟…</Text>}
        {!!note && !segmenting && <Text className="card__tip">{note}</Text>}
      </View>

      {/* 容差（AI 抠图模式下无需调节） */}
      {image && !aiSeg && (
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

      {/* 结果：AI 抠图/本地处理中显示占位动画（上传/抠图分阶段文案） */}
      {(result || segmenting || busy) && image && (
        <View className="card" id="rmbg-result">
          <Text className="card__label">抠图结果</Text>
          <Text className="ai-mark">AI生成</Text>
          {segmenting || (!result && busy) ? (
            <ProcessPlaceholder
              title={
                uploading
                  ? '图片上传中…'
                  : segmenting
                    ? 'AI 正在精细抠图…'
                    : '正在抠图…'
              }
              desc={
                uploading
                  ? '大图上传需要几秒，请保持网络畅通'
                  : segmenting
                    ? '发丝级分割需要几秒钟，请勿退出页面'
                    : '本地处理中，请稍候'
              }
            />
          ) : (
            <>
              <View className="checker" style={{ position: 'relative' }}>
                <Image className="checker__img" src={result} mode="aspectFit" />
                {busy && (
                  <View className="checker__mask">
                    <Text className="checker__mask-text">正在重新处理…</Text>
                  </View>
                )}
              </View>
              {!busy && (
                <Button className="result__save" onClick={() => saveToAlbum(result)}>
                  保存透明 PNG 到相册
                </Button>
              )}
            </>
          )}
        </View>
      )}

      <View className="footer">
        <ConsentCheckbox authed={authed} onGrant={() => setAuthed(true)} />
        <Button
          className={`footer__btn ${!authed || busy ? 'footer__btn--disabled' : ''}`}
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

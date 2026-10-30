import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Canvas, Slider, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { segmentImage } from '../../api/client';
import { uploadImage, downloadTemp } from '../../api/cloud';
import { requestPortraitConsent, hasAgreed } from '../../utils/consent';
import { chooseImage, saveToAlbum, ChosenImage } from '../../utils/image';
import {
  canvasToTempFile,
  fitSize,
  getCanvas,
  getSubjectBBoxFromData,
  loadCanvasImage,
  removeBackgroundPixels,
  sampleCornerColorFromData,
  unsharpMaskPixels,
} from '../../utils/canvas';
import './index.scss';

/** AI 分割路径：人像合成源分辨率上限（手机原图常用 3024/4032，过高吃内存，2560 足够高清） */
const AI_PROC_DIM = 2560;
/** 本地兜底抠图路径：泛洪+羽化是逐像素运算，控制在 1280 保证流畅 */
const LOCAL_PROC_DIM = 1280;
/** 输出放大倍数：规格像素是 300dpi 冲印标准（一寸 295×413），×4 输出保证手机查看/再冲印清晰 */
const OUTPUT_SCALE = 4;

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

/** 预处理结果：已抠好的人像（原图全分辨率 RGB）+ 主体框，参数微调时直接复用 */
interface PreparedSubject {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  bbox: { x: number; y: number; w: number; h: number };
}

/** 在离屏 canvas 上采样照片四角的平均背景色（不依赖 AI） */
async function sampleLocalCorner(
  chosen: ChosenImage,
): Promise<[number, number, number]> {
  const size = fitSize(chosen.width, chosen.height, LOCAL_PROC_DIM);
  const c = await getCanvas('idp-sample');
  c.width = size.w;
  c.height = size.h;
  const ctx = c.getContext('2d');
  const img = await loadCanvasImage(c, chosen.filePath);
  ctx.drawImage(img as unknown as never, 0, 0, size.w, size.h);
  const data = ctx.getImageData(0, 0, size.w, size.h).data;
  return sampleCornerColorFromData(data, size.w, size.h);
}

/**
 * AI 路径预处理（只跑一次，参数微调时复用）：
 * RGB 来自【原图全分辨率】（色彩/细节最丰富），alpha 轮廓来自 AI 分割结果（缩放到同尺寸对齐）。
 * 这样最终合成是从高分辨率人像向下采样，而非把云端小图拉伸放大——这才是"高清"。
 */
async function prepareAiSubject(
  original: ChosenImage,
  segPath: string,
): Promise<PreparedSubject> {
  let maxDim = AI_PROC_DIM;
  // 个别低端机 canvas 尺寸受限，失败一次后降级重试
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const size = fitSize(original.width, original.height, maxDim);
      const canvas = await getCanvas('idp-subject');
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext('2d');

      // 底层：原图全分辨率 RGB
      const srcImg = await loadCanvasImage(canvas, original.filePath);
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(srcImg as unknown as never, 0, 0, size.w, size.h);

      // 上层：AI 分割透明 PNG，取其 alpha 轮廓覆盖到底层
      const segImg = await loadCanvasImage(canvas, segPath);
      const segLayer = ctx.getImageData(0, 0, size.w, size.h); // 先拿到带原图 RGB 的缓冲
      // 用独立 canvas 绘制同尺寸分割图以读取其 alpha
      const segCanvas = await getCanvas('idp-seg');
      segCanvas.width = size.w;
      segCanvas.height = size.h;
      const segCtx = segCanvas.getContext('2d');
      segCtx.imageSmoothingEnabled = true;
      segCtx.imageSmoothingQuality = 'high';
      segCtx.drawImage(segImg as unknown as never, 0, 0, size.w, size.h);
      const segData = segCtx.getImageData(0, 0, size.w, size.h).data;

      // alpha 取分割轮廓，RGB 保留原图
      const out = segLayer.data;
      for (let i = 0; i < out.length; i += 4) {
        out[i + 3] = segData[i + 3];
      }
      ctx.putImageData(segLayer, 0, 0);

      const bbox = getSubjectBBoxFromData(out, size.w, size.h);
      return { data: out, width: size.w, height: size.h, bbox };
    } catch (err) {
      if (attempt === 0) {
        maxDim = 1600;
        continue;
      }
      throw err;
    }
  }
  throw new Error('AI 人像预处理失败');
}

/** 本地兜底预处理：泛洪抠图（逐像素运算，1280 内流畅），容差变化需重跑 */
async function prepareLocalSubject(
  chosen: ChosenImage,
  ref: [number, number, number],
  tol: number,
): Promise<PreparedSubject> {
  const size = fitSize(chosen.width, chosen.height, LOCAL_PROC_DIM);
  const canvas = await getCanvas('idp-subject');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  const img = await loadCanvasImage(canvas, chosen.filePath);
  ctx.clearRect(0, 0, size.w, size.h);
  ctx.drawImage(img as unknown as never, 0, 0, size.w, size.h);
  const imageData = ctx.getImageData(0, 0, size.w, size.h);
  const bbox = removeBackgroundPixels(imageData.data, size.w, size.h, ref, tol);
  ctx.putImageData(imageData, 0, 0);
  return { data: imageData.data, width: size.w, height: size.h, bbox };
}

export default function IdPhoto() {
  // 肖像权授权门禁：授权通过前不渲染页面内容（防弹窗弹出前空窗期操作）
  const [authed, setAuthed] = useState(() => hasAgreed());
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
  const [uploading, setUploading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 预处理人像缓存：键含模式+容差，背景色/规格微调时直接复用，不重复抠图
  const prepRef = useRef<{
    key: string;
    subject: PreparedSubject | null;
  }>({ key: '', subject: null });

  // 进入页面即确认肖像权授权：同意一次永久记住；拒绝则退回
  useDidShow(() => {
    if (hasAgreed()) {
      setAuthed(true);
      return;
    }
    requestPortraitConsent(
      () => setAuthed(true),
      () => {
        Taro.showToast({ title: '未同意授权，无法使用该工具', icon: 'none' });
        setTimeout(() => {
          Taro.navigateBack({
            fail: () => Taro.reLaunch({ url: '/pages/index/index' }),
          });
        }, 900);
      },
    );
  });

  /** 高清合成：从预处理的高分辨率人像【向下采样】到输出尺寸 + unsharp 锐化 */
  const compose = useCallback(
    async (subject: PreparedSubject, bg: string, sp: IdSpec) => {
      const W = sp.w * OUTPUT_SCALE;
      const H = sp.h * OUTPUT_SCALE;
      const out = await getCanvas('idp-out');
      out.width = W;
      out.height = H;
      const octx = out.getContext('2d');
      const subjectCanvas = await getCanvas('idp-subject');

      // 背景
      octx.fillStyle = bg;
      octx.fillRect(0, 0, W, H);

      const { bbox } = subject;
      if (bbox.w > 0 && bbox.h > 0) {
        // 证件照构图：人像约占 82%，水平居中；底部贴底边（微超 1%，胸口自然裁切）
        // 直接把高分辨率人像画布整体变换到输出坐标，GPU 高质量向下采样 = 真高清
        const k = OUTPUT_SCALE;
        const cx = bbox.x + bbox.w / 2;
        const scale = Math.max(sp.w / bbox.w, sp.h / bbox.h) * 0.82;
        octx.save();
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';
        octx.translate(W / 2 - cx * scale * k, H * 1.01 - (bbox.y + bbox.h) * scale * k);
        octx.scale(scale * k, scale * k);
        octx.drawImage(subjectCanvas as unknown as never, 0, 0);
        octx.restore();
      } else {
        // 兜底：contain 等比适配，绝不拉伸变形
        const scale = Math.min(W / subject.width, H / subject.height);
        const dw = subject.width * scale;
        const dh = subject.height * scale;
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(
          subjectCanvas as unknown as never,
          (W - dw) / 2,
          (H - dh) / 2,
          dw,
          dh,
        );
      }

      // 下采样后做一次轻锐化，补偿边缘（发丝/五官），提升真实清晰感（纯色背景不受影响）
      const imageData = octx.getImageData(0, 0, W, H);
      unsharpMaskPixels(imageData.data, W, H, 3);
      octx.putImageData(imageData, 0, 0);

      return canvasToTempFile(out, { fileType: 'jpg', quality: 0.95 });
    },
    [],
  );

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
        // 1. 预处理透明人像（仅模式/容差变化时重跑；背景色与规格变化走缓存）
        const key = seg ? `ai:${seg}` : `local:${tol}`;
        let subject = prepRef.current.subject;
        if (prepRef.current.key !== key || !subject) {
          subject = seg
            ? await prepareAiSubject(img, seg)
            : await prepareLocalSubject(img, ref, tol);
          prepRef.current = { key, subject };
        }
        // 2. 高清合成
        const path = await compose(subject, bg, sp);
        setResult(path);
      } catch (err) {
        console.error(err);
        prepRef.current = { key: '', subject: null };
        Taro.showToast({ title: '生成失败，请重试', icon: 'none' });
      } finally {
        setBusy(false);
      }
    },
    [compose],
  );

  const pickImage = async () => {
    console.log('[pick] 证件照·选图按钮点击');
    try {
      const chosen = await chooseImage({ secCheck: true });
      if (!chosen) return;
      console.log('[pick] 开始上传');
      setImage(chosen);
      setResult('');
      setTolerance(16);
      setNote('');
      setAiSeg(null);
      prepRef.current = { key: '', subject: null };

      // 1. 优先：云函数 AI 人像分割（发丝级，适配复杂背景）
      setSegmenting(true);
      setUploading(true);
      setNote('图片上传中…');
      try {
        const inputFileID = await uploadImage(chosen.filePath);
        console.log('[pick] 上传成功:', inputFileID);
        setUploading(false);
        setNote('AI 抠图中，复杂背景也能自动去除…');
        const res = await segmentImage(inputFileID);
        if (!res.fileID) throw new Error(res.error || 'AI 抠图失败');
        const segPath = await downloadTemp(res.fileID);
        setAiSeg(segPath);
        setSegmenting(false);
        setNote('AI 已自动去除背景，直接选背景色与规格即可');
        await generate(chosen, refColor, 16, bgColor, spec, segPath);
        return;
      } catch {
        setUploading(false);
        setSegmenting(false);
        setNote('AI 抠图不可用，已切换本地抠图模式');
      }

      // 2. 兜底：本地采样四角背景色 + 泛洪抠图
      setBusy(true);
      try {
        const bg = await sampleLocalCorner(chosen);
        setRefColor(bg);
        setNote('已使用照片背景色，可拖动容差优化抠图');
        await generate(chosen, bg, 16, bgColor, spec, null);
      } finally {
        setBusy(false);
      }
    } catch (err) {
      console.error(err);
      setBusy(false);
    }
  };

  // 首次生成时自动滚动到结果区，让用户看到生成进度（后续微调参数不打断滚动位置）
  useEffect(() => {
    if ((segmenting || busy) && !result) {
      // 占位区需等本次渲染提交后才存在，延迟一拍再滚动
      const t = setTimeout(() => {
        Taro.pageScrollTo({ selector: '#idp-result', duration: 250 }).catch(() => {});
      }, 120);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmenting, busy]);

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

  if (!authed) return null;

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

      {/* 结果：选图后即展示，生成中显示占位动画与分阶段进度文案 */}
      {image && (
        <View className="card" id="idp-result">
          <Text className="card__label">
            {spec.name} {spec.w * OUTPUT_SCALE}×{spec.h * OUTPUT_SCALE}px
          </Text>
          <Text className="ai-mark">AI生成</Text>

          {result && !(segmenting && !aiSeg) ? (
            <View className="photo-wrap">
              <Image className="photo" src={result} mode="aspectFit" />
              {/* 切换规格/背景色等重生成时，在旧图上覆盖提示 */}
              {busy && (
                <View className="photo-mask">
                  <View className="spinner" />
                  <Text className="photo-mask__text">正在重新生成…</Text>
                </View>
              )}
            </View>
          ) : (
            <View className="photo-wrap">
              <View className="photo photo--placeholder">
                <View className="spinner spinner--lg" />
                <Text className="placeholder__title">
                  {uploading
                    ? '图片上传中…'
                    : segmenting
                      ? 'AI 正在精细抠图…'
                      : '正在生成证件照…'}
                </Text>
                <Text className="placeholder__desc">
                  {uploading
                    ? '大图上传需要几秒，请保持网络畅通'
                    : segmenting
                      ? '发丝级分割需要几秒，请勿退出页面'
                      : '正在合成背景与构图…'}
                </Text>
              </View>
            </View>
          )}

          {!busy && !segmenting && result && (
            <Button className="result__save" onClick={() => saveToAlbum(result)}>
              保存到相册
            </Button>
          )}
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
        id="idp-seg"
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

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Canvas, Image, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import {
  MiniCanvas,
  MiniCanvasContext2D,
  MiniImage,
  fitSize,
  getCanvas,
  loadCanvasImage,
  canvasToTempFile,
} from '../utils/canvas';

export interface BrushCanvasHandle {
  /** 是否已涂抹 */
  hasMask: () => boolean;
  /** 撤销上一笔 */
  undo: () => void;
  /** 清空涂抹 */
  clear: () => void;
  /** 合成「原图 + 蒙版」导出为临时文件路径（供转 dataURL 上传 AI） */
  getComposedFile: () => Promise<string | null>;
}

interface BrushCanvasProps {
  /** 唯一 id 前缀（页面内有多个 canvas 时避免冲突） */
  canvasId: string;
  /** 图片本地路径 */
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  /** 蒙版颜色 */
  maskColor?: string;
  maskOpacity?: number;
  /** 笔刷直径（显示 px） */
  brushSize: number;
}

interface Stroke {
  size: number;
  points: { x: number; y: number }[];
}

/** 处理副本最长边（涂抹精度足够 AI 识别，兼顾内存） */
const PROC_MAX_DIM = 1200;

/**
 * 涂抹编辑器：底层原图 + 上层半透明蒙版画布。
 * 笔画以路径记录，撤销时重绘（避免 ImageData 快照占用大量内存）。
 */
export const BrushCanvas = forwardRef<BrushCanvasHandle, BrushCanvasProps>(
  function BrushCanvas(
    {
      canvasId,
      imagePath,
      imageWidth,
      imageHeight,
      maskColor = '#f59e0b',
      maskOpacity = 0.55,
      brushSize,
    },
    ref,
  ) {
    const maskId = `${canvasId}-mask`;
    const composeId = `${canvasId}-compose`;
    const [ready, setReady] = useState(false);

    const maskRef = useRef<MiniCanvas | null>(null);
    const ctxRef = useRef<MiniCanvasContext2D | null>(null);
    const imgRef = useRef<MiniImage | null>(null);
    const procRef = useRef({ w: 0, h: 0 });
    const rectRef = useRef({ left: 0, top: 0, width: 1, height: 1 });
    const strokesRef = useRef<Stroke[]>([]);
    const drawingRef = useRef(false);

    const redrawAll = useCallback(() => {
      const ctx = ctxRef.current;
      const { w, h } = procRef.current;
      if (!ctx || !w || !h) return;
      ctx.clearRect(0, 0, w, h);
      for (const s of strokesRef.current) {
        ctx.strokeStyle = maskColor;
        ctx.globalAlpha = maskOpacity;
        ctx.lineWidth = s.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        s.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        if (s.points.length === 1) {
          const p = s.points[0];
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 0.1, p.y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }, [maskColor, maskOpacity]);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          // 显示尺寸：容器宽度实测，按图片比例定高
          const proc = fitSize(imageWidth, imageHeight, PROC_MAX_DIM);
          procRef.current = proc;

          const mask = await getCanvas(maskId);
          if (cancelled) return;
          mask.width = proc.w;
          mask.height = proc.h;
          maskRef.current = mask;
          ctxRef.current = mask.getContext('2d');

          imgRef.current = await loadCanvasImage(mask, imagePath);
          if (cancelled) return;

          // 量取画布在屏幕上的位置与显示尺寸
          const rect = await new Promise<{ left: number; top: number; width: number; height: number }>(
            (resolve, reject) => {
              Taro.createSelectorQuery()
                .select(`#${maskId}`)
                .boundingClientRect()
                .exec((res) => {
                  const r = res?.[0];
                  if (!r) reject(new Error('画布测量失败'));
                  else resolve({ left: r.left, top: r.top, width: r.width, height: r.height });
                });
            },
          );
          rectRef.current = rect;
          if (!cancelled) setReady(true);
        } catch (err) {
          console.error('BrushCanvas init error', err);
        }
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imagePath]);

    interface BrushTouchPoint {
      x?: number;
      y?: number;
      clientX?: number;
      clientY?: number;
    }

    interface BrushTouchEvent {
      touches: BrushTouchPoint[];
    }

    const toCanvasPoint = (t: BrushTouchPoint) => {
      const rect = rectRef.current;
      const { w, h } = procRef.current;
      // 优先使用相对 canvas 的 x/y，否则用 clientX/clientY 换算
      const px = typeof t.x === 'number' ? t.x : (t.clientX ?? rect.left) - rect.left;
      const py = typeof t.y === 'number' ? t.y : (t.clientY ?? rect.top) - rect.top;
      return {
        x: (px / rect.width) * w,
        y: (py / rect.height) * h,
      };
    };

    const handleTouchStart = (e: BrushTouchEvent) => {
      if (!ready) return;
      drawingRef.current = true;
      const t = e.touches[0];
      if (!t) return;
      const p = toCanvasPoint(t);
      const scale = procRef.current.w / rectRef.current.width;
      strokesRef.current.push({ size: brushSize * scale, points: [p] });
      redrawAll();
    };

    const handleTouchMove = (e: BrushTouchEvent) => {
      if (!drawingRef.current || !ready) return;
      const t = e.touches[0];
      if (!t) return;
      const p = toCanvasPoint(t);
      const cur = strokesRef.current[strokesRef.current.length - 1];
      if (!cur) return;
      cur.points.push(p);
      redrawAll();
    };

    const handleTouchEnd = () => {
      drawingRef.current = false;
    };

    useImperativeHandle(ref, () => ({
      hasMask: () => strokesRef.current.length > 0,
      undo: () => {
        strokesRef.current.pop();
        redrawAll();
      },
      clear: () => {
        strokesRef.current = [];
        redrawAll();
      },
      getComposedFile: async () => {
        const { w, h } = procRef.current;
        const mask = maskRef.current;
        const img = imgRef.current;
        if (!w || !h || !mask || !img || strokesRef.current.length === 0) {
          return null;
        }
        const compose = await getCanvas(composeId);
        compose.width = w;
        compose.height = h;
        const cctx = compose.getContext('2d');
        cctx.clearRect(0, 0, w, h);
        cctx.drawImage(img as unknown as never, 0, 0, w, h);
        // 屏幕上蒙版是半透明（便于看清涂抹范围），送 AI 的合成图需把涂鸦压成实色：
        // Seedream 涂鸦编辑依赖颜色鲜明的涂鸦定位，半透明小区域易被模型忽略。
        const solidId = `${composeId}-solid`;
        const solid = await getCanvas(solidId);
        solid.width = w;
        solid.height = h;
        const sctx = solid.getContext('2d');
        sctx.globalCompositeOperation = 'source-over';
        sctx.clearRect(0, 0, w, h);
        sctx.drawImage(mask as unknown as never, 0, 0);
        sctx.globalCompositeOperation = 'source-in';
        sctx.fillStyle = maskColor;
        sctx.fillRect(0, 0, w, h);
        cctx.drawImage(solid as unknown as never, 0, 0);
        return canvasToTempFile(compose, { fileType: 'png' });
      },
    }));

    const ratio = imageWidth > 0 ? imageHeight / imageWidth : 1;

    return (
      <View className="brush">
        <View
          className="brush__stage"
          style={{ paddingBottom: `${Math.min(150, ratio * 100)}%` }}
        >
          <Image className="brush__img" src={imagePath} mode="aspectFit" />
          <Canvas
            type="2d"
            id={maskId}
            className="brush__mask"
            disableScroll
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          />
        </View>
        {/* 隐藏合成画布 */}
        <Canvas
          type="2d"
          id={composeId}
          style={{
            position: 'fixed',
            left: '-9999px',
            top: '-9999px',
            width: '10px',
            height: '10px',
          }}
        />
        {/* 隐藏实色蒙版画布（送 AI 涂鸦定位用） */}
        <Canvas
          type="2d"
          id={`${composeId}-solid`}
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
  },
);

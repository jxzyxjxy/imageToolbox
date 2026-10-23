'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Undo2, Trash2, Brush } from 'lucide-react';

interface BrushEditorProps {
  imageUrl: string;
  /** 蒙版高亮色 */
  maskColor?: string;
  /** 蒙版透明度 */
  maskOpacity?: number;
}

export interface BrushEditorHandle {
  /** 是否已涂抹 */
  hasMask: () => boolean;
  /** 返回「原图 + 蒙版」合成的 DataURL（用于上传给 AI 指示涂抹区域） */
  getComposedDataUrl: () => string | null;
}

interface Point {
  x: number;
  y: number;
}

/**
 * 涂抹编辑器：底层原图 + 上层半透明蒙版。
 * 支持触摸/鼠标绘制、笔刷大小、撤销与清空。
 */
export const BrushEditor = forwardRef<BrushEditorHandle, BrushEditorProps>(
  function BrushEditor(
    { imageUrl, maskColor = '#f43f5e', maskOpacity = 0.5 },
    ref,
  ) {
    const baseRef = useRef<HTMLCanvasElement>(null);
    const maskRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const lastRef = useRef<Point | null>(null);
    // 已提交的每一笔蒙版快照，用于撤销
    const historyRef = useRef<ImageData[]>([]);

    const [brushSize, setBrushSize] = useState(28);
    const [ready, setReady] = useState(false);
    const [hasStroke, setHasStroke] = useState(false);

    useImperativeHandle(ref, () => ({
      hasMask: () => historyRef.current.length > 0,
      getComposedDataUrl: () => {
        const base = baseRef.current;
        const mask = maskRef.current;
        if (!base || !mask || historyRef.current.length === 0) return null;
        // 屏幕上半透明蒙版仅供预览；导出给 AI 前把涂抹区压成实色，涂鸦定位更准确
        const solid = document.createElement('canvas');
        solid.width = base.width;
        solid.height = base.height;
        const solidCtx = solid.getContext('2d')!;
        solidCtx.drawImage(mask, 0, 0);
        solidCtx.globalCompositeOperation = 'source-in';
        solidCtx.fillStyle = maskColor;
        solidCtx.fillRect(0, 0, base.width, base.height);
        const composed = document.createElement('canvas');
        composed.width = base.width;
        composed.height = base.height;
        const ctx = composed.getContext('2d')!;
        ctx.drawImage(base, 0, 0);
        ctx.drawImage(solid, 0, 0);
        return composed.toDataURL('image/png');
      },
    }));

    useEffect(() => {
      const img = new Image();
      img.onload = () => {
        const base = baseRef.current;
        const mask = maskRef.current;
        if (!base || !mask) return;
        base.width = img.naturalWidth;
        base.height = img.naturalHeight;
        mask.width = img.naturalWidth;
        mask.height = img.naturalHeight;
        base.getContext('2d')!.drawImage(img, 0, 0);
        historyRef.current = [];
        setHasStroke(false);
        setReady(true);
      };
      img.src = imageUrl;
    }, [imageUrl]);

    const getPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const canvas = maskRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const startStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = maskRef.current;
      if (!canvas || !ready) return;
      const ctx = canvas.getContext('2d')!;
      // 保存笔画前快照
      historyRef.current.push(
        ctx.getImageData(0, 0, canvas.width, canvas.height),
      );
      drawingRef.current = true;
      lastRef.current = getPoint(e);
      canvas.setPointerCapture(e.pointerId);
      paintAt(lastRef.current);
    };

    const moveStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const point = getPoint(e);
      paintSegment(lastRef.current!, point);
      lastRef.current = point;
    };

    const endStroke = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      lastRef.current = null;
      setHasStroke(historyRef.current.length > 0);
    };

    const paintAt = (p: Point) => {
      const canvas = maskRef.current!;
      const ctx = canvas.getContext('2d')!;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = maskColor;
      ctx.globalAlpha = maskOpacity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    const paintSegment = (from: Point, to: Point) => {
      const canvas = maskRef.current!;
      const ctx = canvas.getContext('2d')!;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = maskColor;
      ctx.globalAlpha = maskOpacity;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const undo = () => {
      const canvas = maskRef.current;
      if (!canvas) return;
      const last = historyRef.current.pop();
      if (last) {
        canvas.getContext('2d')!.putImageData(last, 0, 0);
        setHasStroke(historyRef.current.length > 0);
      }
    };

    const clear = () => {
      const canvas = maskRef.current;
      if (!canvas) return;
      canvas
        .getContext('2d')!
        .clearRect(0, 0, canvas.width, canvas.height);
      historyRef.current = [];
      setHasStroke(false);
    };

    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <canvas ref={baseRef} className="block w-full h-auto" />
          <canvas
            ref={maskRef}
            className="absolute inset-0 w-full h-auto touch-none cursor-crosshair"
            onPointerDown={startStroke}
            onPointerMove={moveStroke}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
          />
        </div>

        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
          <Brush className="h-4 w-4 shrink-0 text-indigo-500" />
          <input
            type="range"
            min={10}
            max={80}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-500"
          />
          <span className="w-12 shrink-0 text-right text-xs font-medium text-slate-500">
            {brushSize}px
          </span>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={undo}
              disabled={!hasStroke}
              aria-label="撤销"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-100 transition hover:text-indigo-500 disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={!hasStroke}
              aria-label="清空"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-100 transition hover:text-rose-500 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  },
);

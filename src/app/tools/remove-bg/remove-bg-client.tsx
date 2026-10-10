'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Pipette, Download, RotateCcw } from 'lucide-react';
import ToolHeader from '@/components/tool-header';
import Dropzone from '@/components/dropzone';
import BottomBar from '@/components/bottom-bar';
import {
  readFileAsDataURL,
  loadImage,
  drawToCanvas,
  removeBackground,
  canvasToBlob,
  downloadBlob,
} from '@/lib/image-processing';
import { tools } from '@/lib/tools';
import { cn } from '@/lib/utils';

const tool = tools.find((t) => t.slug === 'remove-bg')!;

async function analyzeBackground(imageBase64: string): Promise<{
  bg: [number, number, number];
  uniform: boolean;
  note?: string;
}> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 }),
  });
  if (!res.ok) throw new Error('AI 分析失败');
  return res.json();
}

export default function RemoveBgClient() {
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [refColor, setRefColor] = useState<[number, number, number]>([245, 245, 245]);
  const [tolerance, setTolerance] = useState(16);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFile = useCallback(async (file: File) => {
    const url = await readFileAsDataURL(file);
    const img = await loadImage(url);
    const canvas = drawToCanvas(img, 1280);
    setSourceCanvas(canvas);
    setResultUrl(null);
    setNote('');
    setRefColor(sampleCornerColor(canvas));
  }, []);

  // 绘制显示画布
  useEffect(() => {
    if (sourceCanvas && displayCanvasRef.current) {
      displayCanvasRef.current.width = sourceCanvas.width;
      displayCanvasRef.current.height = sourceCanvas.height;
      displayCanvasRef.current.getContext('2d')!.drawImage(sourceCanvas, 0, 0);
    }
  }, [sourceCanvas]);

  const runAi = useCallback(async () => {
    if (!sourceCanvas) return;
    setAnalyzing(true);
    try {
      const thumb = drawToCanvas(sourceCanvas, 320);
      const base64 = thumb.toDataURL('image/jpeg', 0.8);
      const res = await analyzeBackground(base64);
      setRefColor(res.bg);
      setPicking(false);
      setNote(
        res.note ||
          (res.uniform ? '已识别到纯色背景' : '背景较复杂，可手动点击图片取色微调'),
      );
    } catch {
      setNote('AI 识别失败，请手动点击图片取色');
    } finally {
      setAnalyzing(false);
    }
  }, [sourceCanvas]);

  const handlePick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!picking || !sourceCanvas) return;
      const canvas = displayCanvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
      const d = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
      setRefColor([d[0], d[1], d[2]]);
      setPicking(false);
      setNote('已手动取色，可拖动滑块调整效果');
    },
    [picking, sourceCanvas],
  );

  useEffect(() => {
    if (!sourceCanvas) return;
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const { canvas } = removeBackground(sourceCanvas, refColor, tolerance);
        setResultUrl(canvas.toDataURL('image/png'));
      } catch (e) {
        console.error(e);
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sourceCanvas, refColor, tolerance]);

  const handleDownload = useCallback(async () => {
    if (!sourceCanvas) return;
    const { canvas, bbox } = removeBackground(sourceCanvas, refColor, tolerance);
    const cropped = document.createElement('canvas');
    cropped.width = bbox.w;
    cropped.height = bbox.h;
    cropped
      .getContext('2d')!
      .drawImage(canvas, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
    const blob = await canvasToBlob(cropped, 'image/png');
    downloadBlob(blob, 'background-removed.png');
  }, [sourceCanvas, refColor, tolerance]);

  return (
    <div className="pb-28">
      <ToolHeader {...tool} />

      {!sourceCanvas ? (
        <Dropzone
          onFile={handleFile}
          hint="背景干净、主体清晰的图片效果最佳"
        />
      ) : (
        <div className="space-y-4">
          {/* 控制面板 */}
          <div className="rounded-2xl border border-black/[0.04] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={runAi}
                disabled={analyzing}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-600 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(124,58,237,0.28)] transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {analyzing ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                AI 识别
              </button>
              <button
                onClick={() => setPicking((v) => !v)}
                className={cn(
                  'inline-flex h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition-colors',
                  picking
                    ? 'border-violet-400 bg-violet-50 text-violet-700'
                    : 'border-black/10 text-[#3f3f46] active:bg-black/[0.03]',
                )}
              >
                <Pipette className="h-4 w-4" />
                {picking ? '点击图片取色' : '手动取色'}
              </button>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium text-[#3f3f46]">容差（灵敏度）</span>
                <span className="text-[#71717a]">{tolerance}</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-violet-500"
              />
              <p className="mt-2 text-[11px] text-[#a1a1aa]">
                当前参考色 RGB({refColor[0]}, {refColor[1]}, {refColor[2]})
              </p>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => {
                  setTolerance(16);
                  if (sourceCanvas) setRefColor(sampleCornerColor(sourceCanvas));
                  setNote('');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[#71717a] active:bg-black/[0.03]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重置
              </button>
              {note && <span className="text-xs text-violet-600">{note}</span>}
            </div>
          </div>

          {/* 对比 */}
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <div className="px-4 py-3 text-sm font-medium text-[#3f3f46]">
                原图 {picking && <span className="ml-1 text-[12px] text-violet-500">· 取色模式</span>}
              </div>
              <div className="flex items-center justify-center bg-[#f4f5f8] p-3">
                <canvas
                  ref={displayCanvasRef}
                  onMouseDown={handlePick}
                  className={cn(
                    'max-h-[360px] max-w-full rounded-lg',
                    picking && 'cursor-crosshair ring-2 ring-violet-400',
                  )}
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <div className="px-4 py-3 text-sm font-medium text-[#3f3f46]">
                抠图结果 <span className="ml-1 text-[11px] font-normal text-[#a1a1aa]">透明背景</span>
              </div>
              <div
                className="relative flex aspect-square items-center justify-center p-3"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg,#eceef2 25%,transparent 25%),linear-gradient(-45deg,#eceef2 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eceef2 75%),linear-gradient(-45deg,transparent 75%,#eceef2 75%)',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0,0 10px,10px -10px,-10px 0',
                }}
              >
                {busy && (
                  <span className="absolute inset-0 z-10 flex items-center justify-center bg-white/40">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
                  </span>
                )}
                {resultUrl && (
                  <img
                    src={resultUrl}
                    alt="抠图结果"
                    className="max-h-[360px] max-w-full object-contain"
                  />
                )}
                {!resultUrl && !busy && (
                  <span className="text-sm text-[#a1a1aa]">正在处理…</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 底部操作栏 */}
      <BottomBar>
        {sourceCanvas && resultUrl && (
          <button
            onClick={handleDownload}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-indigo-600 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(124,58,237,0.3)] transition-transform active:scale-[0.98]"
          >
            <Download className="h-5 w-5" />
            下载透明 PNG
          </button>
        )}
      </BottomBar>
    </div>
  );
}

function sampleCornerColor(canvas: HTMLCanvasElement): [number, number, number] {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const size = Math.max(1, Math.round(Math.min(w, h) * 0.06));
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const corners: Array<[number, number]> = [
    [0, 0],
    [w - size, 0],
    [0, h - size],
    [w - size, h - size],
  ];
  for (const [cx, cy] of corners) {
    const d = ctx.getImageData(cx, cy, size, size).data;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
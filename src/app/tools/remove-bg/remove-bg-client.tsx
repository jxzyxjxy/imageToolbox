'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Scissors,
  Sparkles,
  Pipette,
  Download,
  RotateCcw,
} from 'lucide-react';
import ToolHeader from '@/components/tool-header';
import Dropzone from '@/components/dropzone';
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
  const [sourceUrl, setSourceUrl] = useState('');
  const [refColor, setRefColor] = useState<[number, number, number]>([245, 245, 245]);
  const [tolerance, setTolerance] = useState(16);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loaded, setLoaded] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    const url = await readFileAsDataURL(file);
    const img = await loadImage(url);
    // 限制处理尺寸以提升性能
    const canvas = drawToCanvas(img, 1280);
    setSourceCanvas(canvas);
    setSourceUrl(canvas.toDataURL('image/png'));
    setResultUrl(null);
    setNote('');
    // 默认参考色取四角平均
    setRefColor(sampleCornerColor(canvas));
  }, []);

  // 绘制显示画布
  useEffect(() => {
    if (sourceCanvas && displayCanvasRef.current) {
      displayCanvasRef.current.width = sourceCanvas.width;
      displayCanvasRef.current.height = sourceCanvas.height;
      displayCanvasRef.current
        .getContext('2d')!
        .drawImage(sourceCanvas, 0, 0);
      setLoaded(true);
    } else {
      setLoaded(false);
    }
  }, [sourceCanvas]);

  const runAi = useCallback(async () => {
    if (!sourceCanvas) return;
    setAnalyzing(true);
    try {
      // 降采样后再发给 AI，减小体积
      const thumb = drawToCanvas(sourceCanvas, 320);
      const base64 = thumb.toDataURL('image/jpeg', 0.8);
      const res = await analyzeBackground(base64);
      setRefColor(res.bg);
      setNote(res.note || (res.uniform ? '已识别到纯色背景' : '背景较复杂，效果可能有限，可手动取色'));
    } catch {
      setNote('AI 识别失败，请手动点击图片取色');
    } finally {
      setAnalyzing(false);
    }
  }, [sourceCanvas]);

  // 点击画布取色
  const handlePick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!picking || !sourceCanvas) return;
      const canvas = displayCanvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
      const ctx = canvas.getContext('2d')!;
      const d = ctx.getImageData(x, y, 1, 1).data;
      setRefColor([d[0], d[1], d[2]]);
      setPicking(false);
      setNote('已手动取色，可在“抠图结果”中查看效果');
    },
    [picking, sourceCanvas],
  );

  // 抠图处理
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
    // 裁剪到主体边界，减少透明留白
    const cropped = document.createElement('canvas');
    cropped.width = bbox.w;
    cropped.height = bbox.h;
    cropped.getContext('2d')!.drawImage(canvas, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
    const blob = await canvasToBlob(cropped, 'image/png');
    downloadBlob(blob, 'background-removed.png');
  }, [sourceCanvas, refColor, tolerance]);

  return (
    <div>
      <ToolHeader {...tool} />

      {!sourceCanvas ? (
        <Dropzone
          onFile={handleFile}
          hint="上传主体清晰、背景相对单一的图片效果最佳"
        />
      ) : (
        <div className="space-y-6">
          {/* 控制栏 */}
          <div className="rounded-2xl border border-black/5 bg-white p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={runAi}
                  disabled={analyzing}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {analyzing ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  AI 智能识别背景
                </button>
                <button
                  onClick={() => setPicking((v) => !v)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
                    picking
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-black/10 text-[#71717a] hover:border-black/20',
                  )}
                >
                  <Pipette className="h-4 w-4" />
                  {picking ? '在图片上点击取色…' : '手动取色'}
                </button>
              </div>
              <button
                onClick={() => {
                  setTolerance(16);
                  if (sourceCanvas) setRefColor(sampleCornerColor(sourceCanvas));
                  setNote('');
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-4 py-2.5 text-sm font-medium text-[#71717a] hover:border-black/20"
              >
                <RotateCcw className="h-4 w-4" />
                重置
              </button>
            </div>

            {/* 容差 */}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-[#3f3f46]">抠图容差（灵敏度）</span>
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
              <p className="mt-2 text-xs text-[#a1a1aa]">
                容差越大，越接近背景色的区域会被去除。当前参考背景色：RGB({refColor[0]}, {refColor[1]}, {refColor[2]})
              </p>
            </div>

            {note && (
              <div className="mt-4 rounded-lg bg-violet-50 px-4 py-2.5 text-sm text-violet-700">
                {note}
              </div>
            )}
          </div>

          {/* 对比 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
              <div className="border-b border-black/5 px-4 py-3 text-sm font-medium text-[#3f3f46]">
                原图 {picking && <span className="ml-1 text-violet-500">· 取色模式</span>}
              </div>
              <div className="flex items-center justify-center bg-[#fafafa] p-4">
                <canvas
                  ref={displayCanvasRef}
                  onMouseDown={handlePick}
                  className={cn(
                    'max-h-[420px] max-w-full rounded-lg',
                    picking && 'cursor-crosshair ring-2 ring-violet-400',
                  )}
                />
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
              <div className="border-b border-black/5 px-4 py-3 text-sm font-medium text-[#3f3f46]">
                抠图结果（透明背景）
              </div>
              <div className="relative flex aspect-square items-center justify-center bg-[#fafafa] p-4"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)',
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
                    className="max-h-[420px] max-w-full object-contain"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleDownload}
              disabled={!resultUrl}
              className="inline-flex items-center gap-2 rounded-lg bg-[#18181b] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              下载透明 PNG
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 采样四角区域的平均色作为参考背景色 */
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
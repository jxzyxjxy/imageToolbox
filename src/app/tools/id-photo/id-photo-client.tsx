'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Download, Camera, RotateCcw } from 'lucide-react';
import ToolHeader from '@/components/tool-header';
import Dropzone from '@/components/dropzone';
import BottomBar from '@/components/bottom-bar';
import {
  readFileAsDataURL,
  loadImage,
  drawToCanvas,
  removeBackground,
  makeIdPhoto,
  canvasToBlob,
  downloadBlob,
  formatBytes,
} from '@/lib/image-processing';
import { tools } from '@/lib/tools';
import { cn } from '@/lib/utils';

const tool = tools.find((t) => t.slug === 'id-photo')!;

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

async function analyzeBackground(imageBase64: string): Promise<{
  bg: [number, number, number];
  uniform: boolean;
}> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 }),
  });
  if (!res.ok) throw new Error('AI 分析失败');
  return res.json();
}

export default function IdPhotoClient() {
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [refColor, setRefColor] = useState<[number, number, number]>([245, 245, 245]);
  const [tolerance, setTolerance] = useState(16);
  const [bgColor, setBgColor] = useState('#2d6bb3');
  const [spec, setSpec] = useState<IdSpec>(SPECS[0]);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFile = useCallback(async (file: File) => {
    const url = await readFileAsDataURL(file);
    const img = await loadImage(url);
    const canvas = drawToCanvas(img, 2048);
    setSourceCanvas(canvas);
    setResultUrl(null);
    setNote('');
    setRefColor(sampleCornerColor(canvas));
  }, []);

  const runAi = useCallback(async () => {
    if (!sourceCanvas) return;
    setAnalyzing(true);
    try {
      const thumb = drawToCanvas(sourceCanvas, 320);
      const base64 = thumb.toDataURL('image/jpeg', 0.8);
      const res = await analyzeBackground(base64);
      setRefColor(res.bg);
      setNote('已识别照片背景');
    } catch {
      setNote('AI 识别失败，已使用默认参考色');
    } finally {
      setAnalyzing(false);
    }
  }, [sourceCanvas]);

  useEffect(() => {
    if (!sourceCanvas) return;
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const { canvas: subject } = removeBackground(sourceCanvas, refColor, tolerance);
        const out = makeIdPhoto(subject, bgColor, spec.w, spec.h);
        const url = out.toDataURL('image/jpeg', 0.92);
        setResultUrl(url);
        const blob = await canvasToBlob(out, 'image/jpeg', 0.92);
        setResultSize(blob.size);
      } catch (e) {
        console.error(e);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sourceCanvas, refColor, tolerance, bgColor, spec]);

  const handleDownload = useCallback(async () => {
    if (!sourceCanvas) return;
    const { canvas: subject } = removeBackground(sourceCanvas, refColor, tolerance);
    const out = makeIdPhoto(subject, bgColor, spec.w, spec.h);
    const blob = await canvasToBlob(out, 'image/jpeg', 0.92);
    downloadBlob(blob, `证件照-${spec.name}-${spec.w}x${spec.h}.jpg`);
  }, [sourceCanvas, refColor, tolerance, bgColor, spec]);

  return (
    <div className="pb-28">
      <ToolHeader {...tool} />

      {!sourceCanvas ? (
        <Dropzone onFile={handleFile} hint="建议使用正面、光线均匀、背景干净的人像照" />
      ) : (
        <div className="space-y-4">
          {/* 背景色 */}
          <div className="rounded-2xl border border-black/[0.04] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <span className="mb-3 block text-sm font-medium text-[#3f3f46]">证件照背景色</span>
            <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {BG_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setBgColor(c.value)}
                  className={cn(
                    'flex shrink-0 flex-col items-center gap-1.5 rounded-2xl border p-2 transition-colors active:scale-95',
                    bgColor === c.value
                      ? 'border-sky-400 bg-sky-50'
                      : 'border-black/10 active:bg-black/[0.03]',
                  )}
                >
                  <span
                    className="h-9 w-9 rounded-xl border border-black/10"
                    style={{ backgroundColor: c.value }}
                  />
                  <span className="text-[11px] text-[#71717a]">{c.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 尺寸规格 */}
          <div className="rounded-2xl border border-black/[0.04] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <span className="mb-3 block text-sm font-medium text-[#3f3f46]">尺寸规格</span>
            <div className="grid grid-cols-3 gap-2">
              {SPECS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSpec(s)}
                  className={cn(
                    'flex flex-col items-center rounded-2xl border px-1 py-3 transition-colors active:scale-95',
                    spec.id === s.id
                      ? 'border-sky-400 bg-sky-50'
                      : 'border-black/10 active:bg-black/[0.03]',
                  )}
                >
                  <span className="text-sm font-semibold text-[#3f3f46]">{s.name}</span>
                  <span className="mt-0.5 text-[10px] text-[#a1a1aa]">
                    {s.mm} · {s.w}×{s.h}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 抠图设置 + AI */}
          <div className="rounded-2xl border border-black/[0.04] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-[#3f3f46]">抠图设置</span>
              <button
                onClick={() => {
                  setRefColor(sampleCornerColor(sourceCanvas!));
                  setTolerance(16);
                  setNote('');
                }}
                className="inline-flex items-center gap-1 text-xs text-[#71717a] active:text-[#18181b]"
              >
                <RotateCcw className="h-3 w-3" />
                重置
              </button>
            </div>
            <button
              onClick={runAi}
              disabled={analyzing}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(14,165,233,0.28)] transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {analyzing ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              AI 智能识别背景
            </button>
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
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-sky-500"
              />
            </div>
            {note && (
              <div className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-700">{note}</div>
            )}
          </div>

          {/* 预览 */}
          <div className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium text-[#3f3f46]">生成预览</span>
              <span className="text-[11px] text-[#a1a1aa]">
                {spec.name} · {spec.w}×{spec.h}px
              </span>
            </div>
            <div className="relative flex aspect-[3/4] items-center justify-center bg-[#f4f5f8] p-4">
              {busy && (
                <span className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
                </span>
              )}
              {resultUrl ? (
                <img
                  src={resultUrl}
                  alt="证件照预览"
                  className="max-h-[440px] max-w-full rounded-md shadow-sm"
                />
              ) : (
                <span className="flex flex-col items-center gap-2 text-sm text-[#a1a1aa]">
                  <Camera className="h-7 w-7" />
                  正在生成…
                </span>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-[#a1a1aa]">
              <span>图片在本地处理，不上传</span>
              {resultSize > 0 && <span>导出 JPG · {formatBytes(resultSize)}</span>}
            </div>
          </div>
        </div>
      )}

      {/* 底部操作栏 */}
      <BottomBar>
        {sourceCanvas && resultUrl && (
          <button
            onClick={handleDownload}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(14,165,233,0.3)] transition-transform active:scale-[0.98]"
          >
            <Download className="h-5 w-5" />
            下载 {spec.name}证件照
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
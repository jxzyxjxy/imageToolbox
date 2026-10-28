'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Camera } from 'lucide-react';
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BottomBar } from '@/components/bottom-bar';
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

async function analyzeBackground(
  imageBase64: string,
): Promise<{ bg: [number, number, number]; uniform: boolean; confidence?: number; note?: string }> {
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
  const [aiSubject, setAiSubject] = useState<HTMLCanvasElement | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFile = useCallback(async (file: File) => {
    const url = await readFileAsDataURL(file);
    const img = await loadImage(url);
    const canvas = drawToCanvas(img, 2048);
    setSourceCanvas(canvas);
    setResultUrl(null);
    setNote('');
    setRefColor(sampleCornerColor(canvas));
    setAiSubject(null);

    // 优先：服务端 AI 人像分割（像素级抠图，适配复杂背景）
    setSegmenting(true);
    try {
      // 超时兜底：服务端异常时不让 loading 卡死，自动回落本地抠图
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch('/api/segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 必须 PNG：透明 PNG 素材的 alpha 不能丢（转 JPEG 会变黑底）
        body: JSON.stringify({ imageBase64: canvas.toDataURL('image/png') }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = (await res.json()) as { dataUrl?: string; error?: string };
      if (!res.ok || !data.dataUrl) throw new Error(data.error || 'segment failed');
      const segImg = await loadImage(data.dataUrl);
      setAiSubject(drawToCanvas(segImg, 2048));
      setNote('AI 已自动去除背景，直接选背景色与规格即可');
    } catch {
      setAiSubject(null);
      setNote('AI 抠图不可用，已切换本地抠图模式，可识别背景色或调节容差');
    } finally {
      setSegmenting(false);
    }
  }, []);

  const runAi = useCallback(async () => {
    if (!sourceCanvas) return;
    setAnalyzing(true);
    try {
      const thumb = drawToCanvas(sourceCanvas, 320);
      const base64 = thumb.toDataURL('image/jpeg', 0.8);
      const res = await analyzeBackground(base64);
      if ((res.confidence ?? 1) >= 0.6) {
        setRefColor(res.bg);
        setNote(res.note || '已识别照片背景');
      } else {
        setNote('背景识别置信度低，已沿用本地采样参考色，可调容差微调');
      }
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
        const subject = aiSubject ?? removeBackground(sourceCanvas, refColor, tolerance).canvas;
        const out = makeIdPhoto(subject, bgColor, spec.w, spec.h);
        setResultUrl(out.toDataURL('image/jpeg', 0.92));
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
  }, [sourceCanvas, aiSubject, refColor, tolerance, bgColor, spec]);

  const reset = useCallback(() => {
    setSourceCanvas(null);
    setResultUrl(null);
    setNote('');
    setTolerance(16);
    setBgColor('#2d6bb3');
    setSpec(SPECS[0]);
    setAiSubject(null);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!sourceCanvas) return;
    const subject = aiSubject ?? removeBackground(sourceCanvas, refColor, tolerance).canvas;
    const out = makeIdPhoto(subject, bgColor, spec.w, spec.h);
    const blob = await canvasToBlob(out, 'image/jpeg', 0.92);
    downloadBlob(blob, `证件照-${spec.name}-${spec.w}x${spec.h}.jpg`);
  }, [sourceCanvas, aiSubject, refColor, tolerance, bgColor, spec]);

  return (
    <div className="flex flex-1 flex-col pb-28">
      <ToolHeader {...tool} />

      <main className="px-5 pt-4">
        {!sourceCanvas ? (
          <Dropzone onFile={handleFile} hint="建议使用正面、光线均匀、背景干净的人像照" />
        ) : (
          <div className="space-y-4">
            {/* 标题卡 */}
            <section className="rounded-[24px] bg-gradient-to-br from-[#6366f1] via-[#8b5cf6] to-[#a855f7] p-5 text-white shadow-[0_10px_24px_rgba(139,92,246,0.32)]">
              <p className="text-[13px] text-white/85">标准证件照，多种背景与尺寸</p>
              <p className="mt-1 text-lg font-bold leading-snug">选好背景色与规格，即时生成</p>
            </section>

            {/* 背景色 */}
            <div className="rounded-[24px] bg-white p-5 shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
              <span className="mb-3 block text-sm font-semibold text-[#1e293b]">证件照背景色</span>
              <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {BG_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setBgColor(c.value)}
                    className={cn(
                      'flex shrink-0 flex-col items-center gap-1.5 rounded-2xl border p-2 transition-colors active:scale-95',
                      bgColor === c.value
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-slate-200 active:bg-slate-50',
                    )}
                  >
                    <span
                      className="h-9 w-9 rounded-xl border border-black/10"
                      style={{ backgroundColor: c.value }}
                    />
                    <span className="text-[11px] text-[#64748b]">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 尺寸规格 */}
            <div className="rounded-[24px] bg-white p-5 shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
              <span className="mb-3 block text-sm font-semibold text-[#1e293b]">尺寸规格</span>
              <div className="grid grid-cols-3 gap-2">
                {SPECS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSpec(s)}
                    className={cn(
                      'flex flex-col items-center rounded-2xl border px-1 py-3 transition-colors active:scale-95',
                      spec.id === s.id
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-slate-200 active:bg-slate-50',
                    )}
                  >
                    <span className="text-sm font-semibold text-[#1e293b]">{s.name}</span>
                    <span className="mt-0.5 text-[10px] text-[#94a3b8]">
                      {s.mm} · {s.w}×{s.h}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* AI 抠图状态 / 本地模式 */}
            <div className="rounded-[24px] bg-white p-5 shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
              {segmenting ? (
                <div className="flex h-12 items-center justify-center gap-2 text-sm font-semibold text-indigo-500">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
                  AI 抠图中，发丝级分割需要几秒钟…
                </div>
              ) : aiSubject ? (
                <div className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-50 text-sm font-semibold text-emerald-600">
                  <Sparkles className="h-4 w-4" />
                  AI 已自动去除背景（复杂背景也适用）
                </div>
              ) : (
                <>
                  <button
                    onClick={runAi}
                    disabled={analyzing}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6366f1] to-[#a855f7] text-sm font-semibold text-white shadow-[0_8px_18px_rgba(99,102,241,0.32)] transition-transform active:scale-[0.98] disabled:opacity-60"
                  >
                    {analyzing ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    AI 智能识别背景
                  </button>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-semibold text-[#1e293b]">容差（灵敏度）</span>
                      <span className="font-semibold text-[#6366f1]">{tolerance}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={tolerance}
                      onChange={(e) => setTolerance(Number(e.target.value))}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-500"
                    />
                  </div>
                </>
              )}
              {note && (
                <div className="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-600">
                  {note}
                </div>
              )}
            </div>

            {/* 预览 */}
            <div className="overflow-hidden rounded-[24px] bg-white shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-semibold text-[#1e293b]">生成预览</span>
                <span className="text-[11px] text-[#94a3b8]">
                  {spec.name} · {spec.w}×{spec.h}px
                </span>
              </div>
              <div className="relative flex aspect-[3/4] items-center justify-center bg-slate-100 p-4">
                {busy && (
                  <span className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
                  </span>
                )}
                {resultUrl ? (
                  <img
                    src={resultUrl}
                    alt="证件照预览"
                    className="max-h-[440px] max-w-full rounded-md shadow-sm"
                  />
                ) : (
                  <span className="flex flex-col items-center gap-2 text-sm text-[#94a3b8]">
                    <Camera className="h-7 w-7" />
                    正在生成…
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-[#94a3b8]">
                <span>图片在本地处理，不上传</span>
                {resultSize > 0 && <span>导出 JPG · {formatBytes(resultSize)}</span>}
              </div>
            </div>
          </div>
        )}
      </main>

      <BottomBar
        primaryLabel={`下载${spec.name}证件照`}
        loadingLabel="生成中…"
        loading={busy}
        disabled={!sourceCanvas || busy}
        onPrimary={handleDownload}
        onSecondary={reset}
      />
    </div>
  );
}

function sampleCornerColor(canvas: HTMLCanvasElement): [number, number, number] {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const size = Math.max(1, Math.round(Math.min(w, h) * 0.06));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
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
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BottomBar } from '@/components/bottom-bar';
import {
  readFileAsDataURL,
  loadImage,
  compressImage,
  downloadBlob,
  formatBytes,
  type CompressResult,
} from '@/lib/image-processing';
import { tools } from '@/lib/tools';
import { cn } from '@/lib/utils';

const tool = tools.find((t) => t.slug === 'compress')!;

export default function CompressClient() {
  const [original, setOriginal] = useState<{
    url: string;
    size: number;
    img: HTMLImageElement;
  } | null>(null);
  const [quality, setQuality] = useState(0.7);
  const [format, setFormat] = useState<'image/jpeg' | 'image/webp' | 'image/png'>(
    'image/jpeg',
  );
  const [result, setResult] = useState<CompressResult | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFile = useCallback(async (file: File) => {
    const url = await readFileAsDataURL(file);
    const img = await loadImage(url);
    setOriginal({ url, size: file.size, img });
    setResult(null);
  }, []);

  useEffect(() => {
    if (!original) return;
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await compressImage(original.img, {
          quality,
          format,
          maxDim: 4096,
        });
        setResult(res);
      } catch (e) {
        console.error(e);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [original, quality, format]);

  const reset = useCallback(() => {
    setOriginal(null);
    setResult(null);
    setQuality(0.7);
    setFormat('image/jpeg');
  }, []);

  const handleDownload = useCallback(() => {
    if (!result) return;
    downloadBlob(result.blob, `compressed.${format.split('/')[1]}`);
  }, [result, format]);

  const savedPct =
    original && result
      ? Math.max(0, Math.round((1 - result.size / original.size) * 100))
      : 0;

  return (
    <div className="flex flex-1 flex-col pb-28">
      <ToolHeader {...tool} />

      <main className="px-5 pt-4">
        {!original ? (
          <Dropzone onFile={handleFile} />
        ) : (
          <div className="space-y-4">
            {/* 标题卡 */}
            <section className="rounded-[24px] bg-gradient-to-br from-emerald-500 to-green-600 p-5 text-white shadow-[0_10px_24px_rgba(16,185,129,0.3)]">
              <p className="text-[13px] text-white/85">压缩质量越低，文件越小</p>
              <p className="mt-1 text-lg font-bold leading-snug">拖动滑块，实时预览体积变化</p>
            </section>

            {/* 控制面板 */}
            <div className="rounded-[24px] bg-white p-5 shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-[#1e293b]">压缩质量</span>
                <span className="font-semibold text-[#6366f1]">{Math.round(quality * 100)}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(quality * 100)}
                onChange={(e) => setQuality(Number(e.target.value) / 100)}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-500"
              />

              <div className="mb-2 mt-5 block text-sm font-semibold text-[#1e293b]">
                输出格式
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { v: 'image/jpeg', label: 'JPG' },
                    { v: 'image/webp', label: 'WebP' },
                    { v: 'image/png', label: 'PNG' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.v}
                    onClick={() => setFormat(f.v)}
                    className={cn(
                      'rounded-2xl border py-3 text-sm font-semibold transition-colors',
                      format === f.v
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-600'
                        : 'border-slate-200 text-[#64748b] active:bg-slate-50',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 对比 */}
            <div className="space-y-3">
              <PreviewCard
                label="原图"
                url={original.url}
                meta={`${original.img.naturalWidth}×${original.img.naturalHeight} · ${formatBytes(original.size)}`}
              />
              <PreviewCard
                label="压缩后"
                url={result?.dataUrl || original.url}
                meta={
                  result
                    ? `${result.width}×${result.height} · ${formatBytes(result.size)}`
                    : '计算中…'
                }
                busy={busy}
                badge={savedPct > 0 ? `节省 ${savedPct}%` : undefined}
              />
            </div>
          </div>
        )}
      </main>

      <BottomBar
        primaryLabel="下载压缩图片"
        loadingLabel="压缩中…"
        loading={busy}
        disabled={!result || busy}
        onPrimary={handleDownload}
        onSecondary={reset}
      />
    </div>
  );
}

function PreviewCard({
  label,
  url,
  meta,
  badge,
  busy,
}: {
  label: string;
  url: string;
  meta: string;
  badge?: string;
  busy?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[24px] bg-white shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold text-[#1e293b]">{label}</span>
        {badge ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">
            <Check className="h-3 w-3" />
            {badge}
          </span>
        ) : (
          <span className="text-[11px] text-[#94a3b8]">{meta}</span>
        )}
      </div>
      <div className="relative flex aspect-[4/3] w-full items-center justify-center bg-slate-100">
        <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/50">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
          </span>
        )}
      </div>
      <div className="px-4 py-2.5 text-[11px] text-[#94a3b8]">{meta}</div>
    </div>
  );
}
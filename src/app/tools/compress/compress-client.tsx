'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Check } from 'lucide-react';
import ToolHeader from '@/components/tool-header';
import Dropzone from '@/components/dropzone';
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

  const savedPct =
    original && result
      ? Math.max(0, Math.round((1 - result.size / original.size) * 100))
      : 0;

  return (
    <div>
      <ToolHeader {...tool} />

      {!original ? (
        <Dropzone
          onFile={handleFile}
          hint="支持 JPG / PNG / WebP，点击或拖拽上传"
        />
      ) : (
        <div className="space-y-6">
          {/* 控制面板 */}
          <div className="rounded-2xl border border-black/5 bg-white p-5">
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-[#3f3f46]">压缩质量</span>
                  <span className="text-[#71717a]">{Math.round(quality * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(quality * 100)}
                  onChange={(e) => setQuality(Number(e.target.value) / 100)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-emerald-500"
                />
              </div>
              <div>
                <span className="mb-2 block text-sm font-medium text-[#3f3f46]">
                  输出格式
                </span>
                <div className="flex gap-2">
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
                        'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                        format === f.v
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-black/10 text-[#71717a] hover:border-black/20',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 预览对比 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PreviewCard
              label="原图"
              url={original.url}
              meta={`${original.img.naturalWidth}×${original.img.naturalHeight} · ${formatBytes(original.size)}`}
            />
            <PreviewCard
              label="压缩后"
              url={result?.dataUrl || original.url}
              meta={result ? `${result.width}×${result.height} · ${formatBytes(result.size)}` : '计算中…'}
              badge={result && original ? `体积 ↓${savedPct}%` : undefined}
              busy={busy}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-5">
            <div className="text-sm text-[#71717a]">
              <span className="font-medium text-[#3f3f46]">压缩效果：</span>
              {original && result ? (
                <>
                  {formatBytes(original.size)} → {formatBytes(result.size)}，节省{' '}
                  <span className="font-semibold text-emerald-600">{savedPct}%</span>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
                  正在处理…
                </span>
              )}
            </div>
            <button
              onClick={() => {
                if (!result) return;
                downloadBlob(result.blob, `compressed.${format.split('/')[1]}`);
              }}
              disabled={!result || busy}
              className="inline-flex items-center gap-2 rounded-lg bg-[#18181b] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              下载压缩图片
            </button>
          </div>
        </div>
      )}
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
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
      <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
        <span className="text-sm font-medium text-[#3f3f46]">{label}</span>
        {badge ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            <Check className="h-3 w-3" />
            {badge}
          </span>
        ) : (
          <span className="text-xs text-[#a1a1aa]">{meta}</span>
        )}
      </div>
      <div className="relative flex aspect-[4/3] w-full items-center justify-center bg-[#fafafa]">
        <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/40">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
          </span>
        )}
      </div>
      <div className="px-4 py-3 text-xs text-[#a1a1aa]">{meta}</div>
    </div>
  );
}
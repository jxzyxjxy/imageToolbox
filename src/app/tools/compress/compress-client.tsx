'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Check } from 'lucide-react';
import ToolHeader from '@/components/tool-header';
import Dropzone from '@/components/dropzone';
import BottomBar from '@/components/bottom-bar';
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
    <div className="pb-28">
      <ToolHeader {...tool} />

      {!original ? (
        <Dropzone
          onFile={handleFile}
          hint="支持 JPG / PNG / WebP"
        />
      ) : (
        <div className="space-y-4">
          {/* 控制面板 */}
          <div className="rounded-2xl border border-black/[0.04] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="mb-1 flex items-center justify-between text-sm">
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
            <div className="mb-1.5 mt-4 block text-sm font-medium text-[#3f3f46]">
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
                    'rounded-xl border py-2.5 text-sm font-medium transition-colors',
                    format === f.v
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-black/10 text-[#71717a] active:bg-black/[0.03]',
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
              highlight={false}
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
              highlight
            />
          </div>
        </div>
      )}

      {/* 底部操作栏 */}
      <BottomBar>
        {original &&
          (() => {
            if (busy) {
              return (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-[#a1a1aa]">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
                  正在处理…
                </div>
              );
            }
            if (!result) return null;
            return (
              <button
                onClick={() =>
                  downloadBlob(
                    result.blob,
                    `compressed.${format.split('/')[1]}`,
                  )
                }
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(16,185,129,0.3)] transition-transform active:scale-[0.98]"
              >
                <Download className="h-5 w-5" />
                下载压缩图片
                {original && (
                  <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-xs font-medium">
                    ↓{savedPct}%
                  </span>
                )}
              </button>
            );
          })()}
      </BottomBar>
    </div>
  );
}

function PreviewCard({
  label,
  url,
  meta,
  badge,
  busy,
  highlight,
}: {
  label: string;
  url: string;
  meta: string;
  badge?: string;
  busy?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-black/[0.04] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        highlight && badge && 'ring-2 ring-emerald-100',
      )}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-medium text-[#3f3f46]">{label}</span>
        {badge ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600">
            <Check className="h-3 w-3" />
            {badge}
          </span>
        ) : (
          <span className="text-[11px] text-[#a1a1aa]">{meta}</span>
        )}
      </div>
      <div className="relative flex aspect-[4/3] w-full items-center justify-center bg-[#f4f5f8]">
        <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/50">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-black/10 border-t-black/40" />
          </span>
        )}
      </div>
      <div className="px-4 py-2.5 text-[11px] text-[#a1a1aa]">{meta}</div>
    </div>
  );
}
'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BottomBar } from '@/components/bottom-bar';
import { ProcessingOverlay } from '@/components/processing-overlay';
import {
  formatBytes,
  loadImage,
  readFileAsDataURL,
  upscaleImage,
  canvasToBlob,
  downloadBlob,
} from '@/lib/image-processing';

const FACTORS = [
  { value: 2, label: '2x', desc: '标准放大' },
  { value: 3, label: '3x', desc: '高清放大' },
  { value: 4, label: '4x', desc: '极致放大' },
];

export function UpscaleClient() {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [fileName, setFileName] = useState('image');
  const [factor, setFactor] = useState(2);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const [dims, setDims] = useState<{ src: string; out: string } | null>(null);
  const [sizes, setSizes] = useState<{ src: number; out: number } | null>(null);
  const [picking, setPicking] = useState(false);

  const handleFile = async (file: File) => {
    setPicking(true);
    try {
      const url = await readFileAsDataURL(file);
      setImageUrl(url);
      setFileName(file.name.replace(/\.[^.]+$/, '') || 'image');
      setResultUrl('');
      setDims(null);
      setSizes(null);
    } finally {
      setPicking(false);
    }
  };

  const handleUpscale = async () => {
    if (!imageUrl) return;
    setProcessing(true);
    try {
      const img = await loadImage(imageUrl);
      const canvas = await upscaleImage(img, factor);
      const blob = await canvasToBlob(canvas, 'image/png');
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
      setDims({
        src: `${img.naturalWidth} × ${img.naturalHeight}`,
        out: `${canvas.width} × ${canvas.height}`,
      });
      // 原始文件大小用 dataUrl 估算
      const srcSize = Math.round((imageUrl.length - imageUrl.indexOf(',') - 1) * 0.75);
      setSizes({ src: srcSize, out: blob.size });
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    fetch(resultUrl)
      .then((r) => r.blob())
      .then((blob) => downloadBlob(blob, `${fileName}_${factor}x_hd.png`));
  };

  return (
    <div className="pb-32">
      <ToolHeader
        title="高清放大"
        description="放大图片并智能锐化，让模糊画面重获清晰细节"
      />

      <div className="space-y-4 px-4">
        {!imageUrl ? (
          <Dropzone
            onFile={handleFile}
            loading={picking}
            loadingLabel="正在读取图片…"
          />
        ) : (
          <>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="原图"
                className="mx-auto max-h-72 w-auto rounded-xl"
              />
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <p className="mb-3 text-sm font-semibold text-slate-800">
                放大倍数
              </p>
              <div className="grid grid-cols-3 gap-3">
                {FACTORS.map((f) => {
                  const active = factor === f.value;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setFactor(f.value)}
                      className={`flex flex-col items-center rounded-2xl border py-3 transition active:scale-95 ${
                        active
                          ? 'border-cyan-400 bg-cyan-50 text-cyan-600 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      <span className="text-base font-bold">{f.label}</span>
                      <span className="mt-0.5 text-[11px] text-slate-400">
                        {f.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-600">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                放大在本地完成，倍数越高处理越久，超大图将自动限制边长以保护性能。
              </p>
            </div>

            {resultUrl && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-cyan-200 bg-cyan-50/50 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resultUrl}
                    alt="放大结果"
                    className="mx-auto max-h-96 w-auto rounded-xl"
                  />
                </div>
                {dims && sizes && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-100">
                      <p className="text-xs text-slate-400">原图</p>
                      <p className="mt-1 text-sm font-semibold text-slate-700">
                        {dims.src}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatBytes(sizes.src)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-100">
                      <p className="text-xs text-cyan-500">放大后</p>
                      <p className="mt-1 text-sm font-semibold text-cyan-600">
                        {dims.out}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatBytes(sizes.out)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {imageUrl && (
        <BottomBar
          primaryLabel={resultUrl ? '重新放大' : '开始放大'}
          onPrimary={handleUpscale}
          loading={processing}
          loadingLabel="正在放大..."
          secondaryLabel={resultUrl ? '保存图片' : undefined}
          onSecondary={resultUrl ? handleDownload : undefined}
        />
      )}

      {processing && (
        <ProcessingOverlay
          label="正在放大…"
          hint="高倍数处理较慢，请勿退出页面"
        />
      )}
    </div>
  );
}

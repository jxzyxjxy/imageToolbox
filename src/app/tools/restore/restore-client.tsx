'use client';

import { useState } from 'react';
import { Sparkles, RefreshCcw } from 'lucide-react';
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BottomBar } from '@/components/bottom-bar';
import { ProcessingOverlay } from '@/components/processing-overlay';
import { readFileAsDataURL, formatBytes, downloadDataUrl } from '@/lib/image-processing';

export function RestoreClient() {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [fileName, setFileName] = useState('image');
  const [processing, setProcessing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [resultUrl, setResultUrl] = useState<string>('');
  const [error, setError] = useState('');
  const [sizes, setSizes] = useState<{ src: number; out: number } | null>(null);

  const handleFile = async (file: File) => {
    setPicking(true);
    try {
      const url = await readFileAsDataURL(file);
      setImageUrl(url);
      setFileName(file.name.replace(/\.[^.]+$/, '') || 'image');
      setResultUrl('');
      setSizes(null);
      setError('');
    } finally {
      setPicking(false);
    }
  };

  const handleRestore = async () => {
    if (!imageUrl) return;
    setProcessing(true);
    setError('');
    try {
      // 1. AI 修复（后端 image-edit restore 模式）
      const editRes = await fetch('/api/image-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageUrl, mode: 'restore' }),
      });
      const editData = await editRes.json();
      if (!editRes.ok || !editData.imageUrl) {
        throw new Error(editData.error || 'AI 修复失败，请重试');
      }

      // 2. 转成本地可预览/下载的 dataURL
      const fetchRes = await fetch('/api/fetch-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: editData.imageUrl }),
      });
      const fetchData = await fetchRes.json();
      if (!fetchRes.ok || !fetchData.dataUrl) {
        throw new Error(fetchData.error || '图片加载失败');
      }

      setResultUrl(fetchData.dataUrl);
      const srcSize = Math.round((imageUrl.length - imageUrl.indexOf(',') - 1) * 0.75);
      const outSize = Math.round(
        (fetchData.dataUrl.length - fetchData.dataUrl.indexOf(',') - 1) * 0.75,
      );
      setSizes({ src: srcSize, out: outSize });
    } catch (e) {
      setError(e instanceof Error ? e.message : '处理失败，请重试');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    downloadDataUrl(resultUrl, `${fileName}_restored.jpg`);
  };

  return (
    <div className="pb-32">
      <ToolHeader
        title="老照片修复"
        description="AI 修复模糊、划痕与褪色，让老照片重焕高清清晰"
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
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-500" />
                <p className="text-sm font-semibold text-slate-800">
                  AI 智能修复
                </p>
              </div>
              <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-600">
                <RefreshCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                自动去除噪点、划痕与褪色，修复破损并增强清晰度。修复结果由 AI
                云端生成，通常需要稍等片刻。
              </p>

              {error && (
                <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500">
                  {error}
                </p>
              )}
            </div>

            {resultUrl && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resultUrl}
                    alt="修复结果"
                    className="mx-auto max-h-96 w-auto rounded-xl"
                  />
                </div>
                {sizes && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-100">
                      <p className="text-xs text-slate-400">修复前</p>
                      <p className="mt-1 text-sm font-semibold text-slate-700">
                        {formatBytes(sizes.src)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-100">
                      <p className="text-xs text-indigo-500">修复后</p>
                      <p className="mt-1 text-sm font-semibold text-indigo-600">
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
          primaryLabel={resultUrl ? '重新修复' : '开始修复'}
          onPrimary={handleRestore}
          loading={processing}
          loadingLabel="AI 修复中..."
          secondaryLabel={resultUrl ? '保存图片' : undefined}
          onSecondary={resultUrl ? handleDownload : undefined}
        />
      )}

      {processing && (
        <ProcessingOverlay
          label="AI 修复中…"
          hint="图片上传与修复约需 10~30 秒，请勿退出"
        />
      )}
    </div>
  );
}
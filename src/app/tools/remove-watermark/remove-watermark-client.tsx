'use client';

import { useRef, useState } from 'react';
import { Loader2, Eraser } from 'lucide-react';
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BrushEditor, type BrushEditorHandle } from '@/components/brush-editor';
import {
  readFileAsDataURL,
  downloadBlob,
} from '@/lib/image-processing';

export function RemoveWatermarkClient() {
  const editorRef = useRef<BrushEditorHandle>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [fileName, setFileName] = useState('image');
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const [error, setError] = useState('');

  const handleFile = async (file: File) => {
    const url = await readFileAsDataURL(file);
    setImageUrl(url);
    setFileName(file.name.replace(/\.[^.]+$/, '') || 'image');
    setResultUrl('');
    setError('');
  };

  const handleProcess = async () => {
    const composed = editorRef.current?.getComposedDataUrl();
    if (!composed) {
      setError('请先涂抹需要去除的水印区域');
      return;
    }
    setProcessing(true);
    setError('');
    try {
      const res = await fetch('/api/image-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: composed, mode: 'watermark' }),
      });
      const data: { imageUrl?: string; error?: string } = await res.json();
      if (!res.ok || !data.imageUrl) {
        setError(data.error || '处理失败，请重试');
        return;
      }
      setResultUrl(data.imageUrl);
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    fetch(resultUrl)
      .then((r) => r.blob())
      .then((blob) => downloadBlob(blob, `${fileName}_no-watermark.png`));
  };

  return (
    <div className="pb-32">
      <ToolHeader
        title="图片去水印"
        description="涂抹水印、文字或 Logo，AI 智能还原干净画面"
      />

      <div className="space-y-4 px-4">
        {!imageUrl ? (
          <Dropzone onFile={handleFile} />
        ) : (
          <>
            <div className="rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 p-5 text-white">
              <p className="text-base font-bold">涂抹要去除的水印</p>
              <p className="mt-1 text-xs text-white/85">
                用手指在水印、文字或 Logo 上涂抹覆盖，区域可略大于水印，AI
                会自动填补还原。
              </p>
            </div>

            <BrushEditor
              ref={editorRef}
              imageUrl={imageUrl}
              maskColor="#f59e0b"
              maskOpacity={0.55}
            />

            {error && (
              <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-xs text-rose-600">
                {error}
              </p>
            )}

            {resultUrl && (
              <div className="space-y-2">
                <p className="px-1 text-sm font-semibold text-slate-800">
                  处理结果
                </p>
                <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resultUrl}
                    alt="去水印结果"
                    className="mx-auto max-h-96 w-auto rounded-xl"
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {imageUrl && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-2">
          <div className="flex gap-3 rounded-2xl border border-slate-100 bg-white/90 p-3 shadow-[0_-4px_24px_rgba(30,41,59,0.08)] backdrop-blur">
            {resultUrl && (
              <button
                type="button"
                onClick={handleDownload}
                className="h-12 flex-1 rounded-xl bg-amber-50 text-sm font-semibold text-amber-600 transition active:scale-[0.98]"
              >
                保存图片
              </button>
            )}
            <button
              type="button"
              onClick={handleProcess}
              disabled={processing}
              className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-sm font-semibold text-white shadow-lg shadow-amber-500/30 transition active:scale-[0.98] disabled:opacity-70"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI 正在修复...
                </>
              ) : (
                <>
                  <Eraser className="h-4 w-4" />
                  {resultUrl ? '再次去除' : '智能去水印'}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

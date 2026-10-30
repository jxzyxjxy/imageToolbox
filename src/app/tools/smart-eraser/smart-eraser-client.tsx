'use client';

import { useRef, useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BrushEditor, type BrushEditorHandle } from '@/components/brush-editor';
import { ProcessingOverlay } from '@/components/processing-overlay';
import { readFileAsDataURL } from '@/lib/image-processing';

export function SmartEraserClient() {
  const editorRef = useRef<BrushEditorHandle>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [fileName, setFileName] = useState('image');
  const [processing, setProcessing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const [error, setError] = useState('');

  const handleFile = async (file: File) => {
    setPicking(true);
    try {
      const url = await readFileAsDataURL(file);
      setImageUrl(url);
      setFileName(file.name.replace(/\.[^.]+$/, '') || 'image');
      setResultUrl('');
      setError('');
    } finally {
      setPicking(false);
    }
  };

  const handleProcess = async () => {
    const composed = editorRef.current?.getComposedDataUrl();
    if (!composed) {
      setError('请先涂抹需要消除的物体或人物');
      return;
    }
    setProcessing(true);
    setError('');
    try {
      const res = await fetch('/api/image-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: composed, mode: 'object' }),
      });
      const data: { imageUrl?: string; error?: string } = await res.json();
      if (!res.ok || !data.imageUrl) {
        setError(data.error || '处理失败，请重试');
        return;
      }
      const proxyRes = await fetch('/api/fetch-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: data.imageUrl }),
      });
      const proxy: { dataUrl?: string; error?: string } = await proxyRes.json();
      if (!proxyRes.ok || !proxy.dataUrl) {
        setError(proxy.error || '结果加载失败，请重试');
        return;
      }
      setResultUrl(proxy.dataUrl);
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = `${fileName}_erased.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="pb-32">
      <ToolHeader
        title="智能消除"
        description="圈选多余的路人、杂物，一键无痕移除"
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
            <div className="rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 p-5 text-white">
              <p className="text-base font-bold">涂抹要消除的内容</p>
              <p className="mt-1 text-xs text-white/85">
                在想移除的路人、杂物或瑕疵上涂抹，建议完整覆盖目标，AI
                会用周围背景无痕填补。
              </p>
            </div>

            <BrushEditor
              ref={editorRef}
              imageUrl={imageUrl}
              maskColor="#ec4899"
              maskOpacity={0.5}
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
                <div className="rounded-2xl border border-pink-200 bg-pink-50/40 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resultUrl}
                    alt="智能消除结果"
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
                className="h-12 flex-1 rounded-xl bg-pink-50 text-sm font-semibold text-pink-600 transition active:scale-[0.98]"
              >
                保存图片
              </button>
            )}
            <button
              type="button"
              onClick={handleProcess}
              disabled={processing}
              className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 text-sm font-semibold text-white shadow-lg shadow-pink-500/30 transition active:scale-[0.98] disabled:opacity-70"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI 正在消除...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  {resultUrl ? '再次消除' : '智能消除'}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {processing && (
        <ProcessingOverlay
          label="AI 消除中…"
          hint="图片上传与处理约需 10~30 秒，请勿退出"
        />
      )}
    </div>
  );
}

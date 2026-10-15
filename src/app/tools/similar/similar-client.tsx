'use client';

import { useState } from 'react';
import { Layers, Download, Images } from 'lucide-react';
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BottomBar } from '@/components/bottom-bar';
import { readFileAsDataURL, downloadDataUrl } from '@/lib/image-processing';

interface ResultItem {
  url: string;
}

const SIZE_OPTIONS: { key: string; label: string }[] = [
  { key: 'auto', label: '自动' },
  { key: 'square', label: '1:1' },
  { key: 'portrait34', label: '3:4' },
  { key: 'landscape43', label: '4:3' },
  { key: 'portrait916', label: '9:16' },
  { key: 'landscape169', label: '16:9' },
];

const COUNT_OPTIONS = [1, 2, 3, 4];

function similarityText(v: number): string {
  if (v >= 80) return '高度相似';
  if (v >= 50) return '较为相似';
  return '自由创作';
}

export function SimilarClient() {
  const [imageUrl, setImageUrl] = useState('');
  const [fileName, setFileName] = useState('image');
  const [sizePreset, setSizePreset] = useState('auto');
  const [similarity, setSimilarity] = useState(70);
  const [count, setCount] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [error, setError] = useState('');

  const handleFile = async (file: File) => {
    const url = await readFileAsDataURL(file);
    setImageUrl(url);
    setFileName(file.name.replace(/\.[^.]+$/, '') || 'image');
    setResults([]);
    setError('');
  };

  const handleGenerate = async () => {
    if (!imageUrl) return;
    setProcessing(true);
    setError('');
    setResults([]);
    try {
      // 1. AI 图生图（后端 similar）
      const genRes = await fetch('/api/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageUrl,
          sizePreset,
          similarity,
          count,
        }),
      });
      const genData = await genRes.json();
      if (!genRes.ok || !Array.isArray(genData.imageUrls) || genData.imageUrls.length === 0) {
        throw new Error(genData.error || '生成失败，请重试');
      }

      // 2. 逐张转成本地可预览/下载的 dataURL
      const items: ResultItem[] = [];
      for (const remote of genData.imageUrls as string[]) {
        const fetchRes = await fetch('/api/fetch-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: remote }),
        });
        const fetchData = await fetchRes.json();
        if (fetchRes.ok && fetchData.dataUrl) {
          items.push({ url: fetchData.dataUrl });
        }
      }
      if (items.length === 0) {
        throw new Error('图片加载失败，请重试');
      }
      setResults(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '处理失败，请重试');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadOne = (url: string, index: number) => {
    downloadDataUrl(url, `${fileName}_similar_${index + 1}.png`);
  };

  const handleDownloadAll = () => {
    results.forEach((r, i) => handleDownloadOne(r.url, i));
  };

  return (
    <div className="pb-32">
      <ToolHeader
        title="生成相似图"
        description="上传图片，AI 生成风格相近的新图，可自定义尺寸与相似度"
      />

      <div className="space-y-4 px-4">
        {!imageUrl ? (
          <Dropzone onFile={handleFile} />
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

            <div className="space-y-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              {/* 输出尺寸 */}
              <div>
                <div className="flex items-center gap-2">
                  <Layers className="h-4.5 w-4.5 text-indigo-500" />
                  <p className="text-sm font-semibold text-slate-800">输出尺寸</p>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {SIZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setSizePreset(opt.key)}
                      className={`rounded-xl border px-2 py-2.5 text-sm font-medium transition-colors ${
                        sizePreset === opt.key
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-600'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 相似度 */}
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">相似度</p>
                  <p className="text-xs font-medium text-indigo-500">
                    {similarity}% · {similarityText(similarity)}
                  </p>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={similarity}
                  onChange={(e) => setSimilarity(Number(e.target.value))}
                  className="mt-3 w-full accent-indigo-500"
                />
                <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                  <span>自由创作</span>
                  <span>贴近原图</span>
                </div>
              </div>

              {/* 生成张数 */}
              <div>
                <p className="text-sm font-semibold text-slate-800">生成张数</p>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {COUNT_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCount(n)}
                      className={`rounded-xl border px-2 py-2.5 text-sm font-medium transition-colors ${
                        count === n
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-600'
                          : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      {n} 张
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500">
                  {error}
                </p>
              )}
            </div>

            {results.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <Images className="h-4.5 w-4.5 text-indigo-500" />
                  <p className="text-sm font-semibold text-slate-800">
                    生成结果（{results.length} 张）
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {results.map((r, i) => (
                    <div
                      key={i}
                      className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.url}
                        alt={`相似图 ${i + 1}`}
                        className="aspect-square w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => handleDownloadOne(r.url, i)}
                        className="flex w-full items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-indigo-600 active:bg-indigo-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        保存第 {i + 1} 张
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {imageUrl && (
        <BottomBar
          primaryLabel={results.length > 0 ? '重新生成' : '开始生成'}
          onPrimary={handleGenerate}
          loading={processing}
          loadingLabel="AI 生成中..."
          secondaryLabel={results.length > 1 ? '全部保存' : undefined}
          onSecondary={results.length > 1 ? handleDownloadAll : undefined}
        />
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import {
  Layers,
  Download,
  Images,
  Sparkles,
  Zap,
  Eraser,
  Mountain,
} from 'lucide-react';

type ModelKey = 'seedream4' | 'seedream5flash';

const MODEL_OPTIONS: {
  key: ModelKey;
  label: string;
  desc: string;
  icon: typeof Sparkles;
}[] = [
  { key: 'seedream4', label: 'Seedream 4.0', desc: '稳定高质', icon: Sparkles },
  { key: 'seedream5flash', label: '5.0 Flash', desc: '新版快速', icon: Zap },
];

const BG_OPTIONS = [
  { key: 'default', label: '默认氛围', desc: 'AI 自由发挥背景', icon: Mountain },
  { key: 'transparent', label: '透明背景', desc: '抠出主体 PNG', icon: Eraser },
] as const;
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BottomBar } from '@/components/bottom-bar';
import { ProcessingOverlay } from '@/components/processing-overlay';
import { readFileAsDataURL, downloadDataUrl } from '@/lib/image-processing';

interface ResultItem {
  url: string;
}

/** 方舟生图模型输出尺寸限制：单边 720 ~ 4096 px，总像素 ≥ 921600 */
const MIN_SIDE = 720;
const MAX_SIDE = 4096;

const COUNT_OPTIONS = [1, 2, 3, 4];

function similarityText(v: number): string {
  if (v >= 80) return '高度相似';
  if (v >= 50) return '较为相似';
  return '自由创作';
}

export function SimilarClient() {
  const [imageUrl, setImageUrl] = useState('');
  const [fileName, setFileName] = useState('image');
  const [modelKey, setModelKey] = useState<ModelKey>('seedream4');
  const [transparent, setTransparent] = useState(false);
  const [origSize, setOrigSize] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [similarity, setSimilarity] = useState(70);
  const [count, setCount] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [error, setError] = useState('');

  const handleFile = async (file: File) => {
    setPicking(true);
    try {
      const url = await readFileAsDataURL(file);
      setImageUrl(url);
      setFileName(file.name.replace(/\.[^.]+$/, '') || 'image');
      setResults([]);
      setError('');
      // 读取原图尺寸，作为默认输出尺寸
      const probe = new Image();
      probe.onload = () => {
        const w = probe.naturalWidth;
        const h = probe.naturalHeight;
        if (w > 0 && h > 0) {
          setOrigSize({ w, h });
          setWidth(String(w));
          setHeight(String(h));
        }
      };
      probe.src = url;
    } finally {
      setPicking(false);
    }
  };

  const handleGenerate = async () => {
    if (!imageUrl) return;
    setProcessing(true);
    setError('');
    setResults([]);
    try {
      // 1. AI 图生图（后端 similar）
      const wNum = Number.parseInt(width, 10);
      const hNum = Number.parseInt(height, 10);
      const genRes = await fetch('/api/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageUrl,
          ...(Number.isFinite(wNum) && Number.isFinite(hNum)
            ? { width: wNum, height: hNum }
            : {}),
          similarity,
          count,
          modelKey,
          transparent,
        }),
      });
      const genData = await genRes.json();
      if (!genRes.ok || !Array.isArray(genData.imageUrls) || genData.imageUrls.length === 0) {
        throw new Error(genData.error || '生成失败，请重试');
      }

      // 2. 逐张转成本地可预览/下载的 dataURL（透明模式后端直接返回 dataURL）
      const items: ResultItem[] = [];
      for (const remote of genData.imageUrls as string[]) {
        if (remote.startsWith('data:')) {
          items.push({ url: remote });
          continue;
        }
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
    const ext = url.startsWith('data:image/jpeg') ? 'jpg' : 'png';
    downloadDataUrl(url, `${fileName}_similar_${index + 1}.${ext}`);
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

            <div className="space-y-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              {/* 生图模型 */}
              <div>
                <p className="text-sm font-semibold text-slate-800">生图模型</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {MODEL_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = modelKey === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setModelKey(opt.key)}
                        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? 'border-indigo-400 bg-indigo-50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            active
                              ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-[13px] font-semibold ${
                              active ? 'text-indigo-600' : 'text-slate-700'
                            }`}
                          >
                            {opt.label}
                          </span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {opt.desc}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 背景 */}
              <div>
                <p className="text-sm font-semibold text-slate-800">背景</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {BG_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active =
                      (opt.key === 'transparent') === transparent;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() =>
                          setTransparent(opt.key === 'transparent')
                        }
                        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? 'border-indigo-400 bg-indigo-50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            active
                              ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-[13px] font-semibold ${
                              active ? 'text-indigo-600' : 'text-slate-700'
                            }`}
                          >
                            {opt.label}
                          </span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {opt.desc}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {transparent && (
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    适合按钮、图标、Logo 等素材：主体之外自动透明，保存为
                    PNG；复杂边缘可能有少量残留
                  </p>
                )}
              </div>

              {/* 输出尺寸 */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4.5 w-4.5 text-indigo-500" />
                    <p className="text-sm font-semibold text-slate-800">
                      输出尺寸
                    </p>
                  </div>
                  {origSize && (
                    <p className="text-xs text-slate-400">
                      原图 {origSize.w} × {origSize.h}
                    </p>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    placeholder="宽度"
                    className="w-full min-w-0 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                  <span className="shrink-0 text-sm text-slate-400">×</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    placeholder="高度"
                    className="w-full min-w-0 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                  {origSize && (
                    <button
                      type="button"
                      onClick={() => {
                        setWidth(String(origSize.w));
                        setHeight(String(origSize.h));
                      }}
                      className="shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs font-medium text-indigo-600 active:bg-indigo-100"
                    >
                      原图尺寸
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  宽高比始终保持不变；尺寸过小会按原比例自动放大（模型要求
                  单边 ≥{MIN_SIDE}、总像素 ≥92 万），最长边 {MAX_SIDE} px
                </p>
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
                <div
                  className={`grid gap-3 ${
                    results.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                  }`}
                >
                  {results.map((r, i) => (
                    <div
                      key={i}
                      className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.url}
                        alt={`相似图 ${i + 1}`}
                        className={
                          results.length === 1
                            ? 'max-h-[480px] w-full bg-slate-100 object-contain'
                            : 'aspect-square w-full bg-slate-100 object-contain'
                        }
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

      {processing && (
        <ProcessingOverlay
          label="AI 生成中…"
          hint="图片上传与生成约需 10~30 秒，请勿退出"
        />
      )}
    </div>
  );
}

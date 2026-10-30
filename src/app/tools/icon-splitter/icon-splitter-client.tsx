'use client';

import { useState } from 'react';
import JSZip from 'jszip';
import { Check, Copy, Download, Image as ImageIcon, Package } from 'lucide-react';
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BottomBar } from '@/components/bottom-bar';
import { ProcessingOverlay } from '@/components/processing-overlay';
import { downloadDataUrl, downloadBlob, readFileAsDataURL } from '@/lib/image-processing';

interface IconItem {
  name: string;
  dataUrl: string;
  w: number;
  h: number;
}
interface SpriteItem {
  index: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface SpriteMeta {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  gap: number;
  items: SpriteItem[];
}

const CHECKER: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%),linear-gradient(45deg,#e5e7eb 25%,#ffffff 25%,#ffffff 75%,#e5e7eb 75%)',
  backgroundSize: '14px 14px',
  backgroundPosition: '0 0, 7px 7px',
};

const SIZE_OPTIONS = [96, 128, 192];
const COLS_OPTIONS = [
  { label: '自动铺行', value: 0 },
  { label: '1 列', value: 1 },
  { label: '2 列', value: 2 },
  { label: '3 列', value: 3 },
  { label: '4 列', value: 4 },
];
const GAP_OPTIONS = [0, 8, 16];

export default function IconSplitterClient() {
  const [source, setSource] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [icons, setIcons] = useState<IconItem[]>([]);
  const [sprite, setSprite] = useState<string | null>(null);
  const [spriteMeta, setSpriteMeta] = useState<SpriteMeta | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);

  const [targetSize, setTargetSize] = useState(128);
  const [cols, setCols] = useState(0);
  const [gap, setGap] = useState(8);

  const handleFile = async (file: File) => {
    if (!file) return;
    setPicking(true);
    try {
      const url = await readFileAsDataURL(file);
      setSource(url);
      setFileName(file.name || '');
      setIcons([]);
      setSprite(null);
      setSpriteMeta(null);
      setError('');
    } finally {
      setPicking(false);
    }
  };

  const run = async () => {
    if (!source) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/split-icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: source, targetSize, cols, gap }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '生成失败');
      if (json.status === 'fail') {
        setError(json.error || '未能识别出多个图标');
        setIcons([]);
        setSprite(null);
        setSpriteMeta(null);
        return;
      }
      setIcons((json.icons || []) as IconItem[]);
      setSprite(json.sprite as string);
      setSpriteMeta(json.spriteMeta as SpriteMeta);
      setNote(typeof json.note === 'string' ? json.note : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const downloadSprite = () => {
    if (sprite) downloadDataUrl(sprite, (fileName.replace(/\.[^.]+$/, '') || 'icons') + '-sprite.png');
  };

  const downloadAll = async () => {
    if (!icons.length || !sprite) return;
    const zip = new JSZip();
    for (let i = 0; i < icons.length; i++) {
      const icon = icons[i];
      zip.file(`${sanitize(icon.name)}-${i + 1}.png`, await (await fetch(icon.dataUrl)).blob());
    }
    zip.file('sprite.png', await (await fetch(sprite!)).blob());
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, (fileName.replace(/\.[^.]+$/, '') || 'icons') + '-sprite.zip');
  };

  const buildCss = () => {
    if (!spriteMeta || !fileName) return '';
    const safe = `icon-${fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const lines = spriteMeta.items.map(
      (it) =>
        `  .${safe}-${it.index} { width:${it.w}px;height:${it.h}px;background:url(./sprites.png) -${it.x}px -${it.y}px no-repeat; }`,
    );
    return lines.join('\n');
  };

  const copyCss = async () => {
    const css = buildCss();
    if (!css) return;
    try {
      await navigator.clipboard.writeText(css);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败，请手动选择');
    }
  };

  return (
    <div className="relative pb-28">
      <ToolHeader
        title="图标拆分 · 雪碧图"
        description="识别图片中的每个 icon，智能高清、去阴影，组合生成雪碧图"
      />

      <div className="space-y-4 px-4 py-4">
        <Dropzone
          onFile={handleFile}
          loading={picking}
          loadingLabel="正在读取图片…"
        />

        {loading && (
          <ProcessingOverlay
            label="AI 拆分中…"
            hint="图片上传与识别约需几秒，请勿退出"
          />
        )}

        {source && icons.length === 0 && (
          <div className="rounded-[24px] bg-white p-4 shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
            <p className="mb-3 text-sm font-semibold text-[#1e293b]">雪碧图参数</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#64748b]">图标尺寸</span>
                <div className="flex gap-1.5">
                  {SIZE_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setTargetSize(s)}
                      className={`h-8 min-w-12 rounded-xl px-2 text-xs font-medium transition ${
                        targetSize === s
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-[#64748b]'
                      }`}
                    >
                      {s}px
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#64748b]">每行列数</span>
                <div className="flex gap-1.5">
                  {COLS_OPTIONS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setCols(c.value)}
                      className={`h-8 rounded-xl px-2.5 text-xs font-medium transition ${
                        cols === c.value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-[#64748b]'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#64748b]">图标间距</span>
                <div className="flex gap-1.5">
                  {GAP_OPTIONS.map((g) => (
                    <button
                      key={g}
                      onClick={() => setGap(g)}
                      className={`h-8 rounded-xl px-2.5 text-xs font-medium transition ${
                        gap === g ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-[#64748b]'
                      }`}
                    >
                      {g === 0 ? '0' : `${g}px`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {sprite && spriteMeta && (
          <>
            <div className="rounded-[24px] bg-white p-4 shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-[#1e293b]">雪碧图</p>
                <div className="flex gap-2">
                  <button
                    onClick={copyCss}
                    className="flex h-8 items-center gap-1 rounded-lg bg-indigo-50 px-2.5 text-xs font-medium text-indigo-600"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? '已复制' : 'CSS 坐标'}
                  </button>
                  <button
                    onClick={downloadSprite}
                    className="flex h-8 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 text-xs font-medium text-white"
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </button>
                </div>
              </div>

              <div
                style={CHECKER}
                className="flex w-full items-center justify-center overflow-auto rounded-2xl border border-slate-200 p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sprite} alt="雪碧图" className="max-w-full object-contain" />
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-[#64748b]">
                <div className="rounded-xl bg-slate-50 py-2">
                  <p className="font-semibold text-[#1e293b]">{icons.length}</p>
                  <p>图标</p>
                </div>
                <div className="rounded-xl bg-slate-50 py-2">
                  <p className="font-semibold text-[#1e293b]">
                    {spriteMeta.cols}×{spriteMeta.rows}
                  </p>
                  <p>网格</p>
                </div>
                <div className="rounded-xl bg-slate-50 py-2">
                  <p className="font-semibold text-[#1e293b]">
                    {spriteMeta.cellW}×{spriteMeta.cellH}
                  </p>
                  <p>单格</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] bg-white p-4 shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
              <p className="mb-3 text-sm font-semibold text-[#1e293b]">
                已拆出 <span className="text-indigo-600">{icons.length}</span> 个图标（高清）
              </p>
              <div className="grid grid-cols-3 gap-3">
                {icons.map((item, i) => (
                  <div key={i} className="relative overflow-hidden rounded-2xl border border-slate-100">
                    <button
                      onClick={() =>
                        downloadDataUrl(item.dataUrl, `${sanitize(item.name)}-${i + 1}.png`)
                      }
                      title="下载该图标"
                      className="absolute z-10 m-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <div
                      style={CHECKER}
                      className="flex aspect-square w-full items-center justify-center p-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.dataUrl}
                        alt={item.name}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <div className="truncate px-2 py-1.5 text-center">
                      <p className="truncate text-[12px] font-medium text-[#1e293b]">{item.name}</p>
                      <p className="text-[10px] text-[#94a3b8]">
                        {item.w}×{item.h}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {error && <p className="px-5 pb-2 text-center text-sm text-rose-500">{error}</p>}
      {note && <p className="px-5 pb-2 text-center text-xs text-amber-600">{note}</p>}

      <BottomBar
        primaryLabel={source ? (icons.length ? '重新生成' : '生成雪碧图') : '生成雪碧图'}
        onPrimary={run}
        loading={loading}
        secondaryLabel={sprite ? '全部打包 ZIP' : undefined}
        onSecondary={sprite ? downloadAll : undefined}
      />

      {!icons.length && (
        <div className="flex items-center justify-center gap-1 px-4 pb-2 text-xs text-[#94a3b8]">
          <ImageIcon className="h-3 w-3" />
          <span>智能识别每个 icon，高清放大、去除阴影，自动组合雪碧图</span>
          <Package className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}

function sanitize(name: string): string {
  const s = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').trim();
  return s || 'icon';
}
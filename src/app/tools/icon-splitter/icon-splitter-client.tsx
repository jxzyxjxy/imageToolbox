'use client';

import { useState, type CSSProperties } from 'react';
import JSZip from 'jszip';
import { Download, PackageCheck, Plus } from 'lucide-react';
import { ToolHeader } from '@/components/tool-header';
import { Dropzone } from '@/components/dropzone';
import { BottomBar } from '@/components/bottom-bar';
import { downloadDataUrl, downloadBlob, readFileAsDataURL } from '@/lib/image-processing';

interface Item {
  name: string;
  dataUrl: string;
  w: number;
  h: number;
}

const CHECKER: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg,#e5e7eb 25%,transparent 25%,transparent 75%,#e5e7eb 75%),linear-gradient(45deg,#e5e7eb 25%,#ffffff 25%,#ffffff 75%,#e5e7eb 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
};

export default function IconSplitterClient() {
  const [source, setSource] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const handleFile = (file: File) => {
    if (!file) return;
    void readFileAsDataURL(file).then((url) => {
      setSource(url);
      setFileName(file.name || '');
      setItems([]);
      setSelected(new Set());
      setError('');
    });
  };

  const run = async () => {
    if (!source) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/split-icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: source }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '拆分失败');
      const list = (json.items || []) as Item[];
      setItems(list);
      setNote(typeof json.note === 'string' ? json.note : '');
      setSelected(new Set(list.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '拆分失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (i: number) => {
    const s = new Set(selected);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    setSelected(s);
  };
  const toggleAll = () => {
    setSelected(selected.size === items.length ? new Set() : new Set(items.map((_, i) => i)));
  };

  const downloadOne = (item: Item) =>
    downloadDataUrl(item.dataUrl, sanitize(item.name) + '.png');

  const downloadAll = async () => {
    if (!items.length || !selected.size) return;
    const zip = new JSZip();
    for (const i of Array.from(selected).sort((a, b) => a - b)) {
      const item = items[i];
      zip.file(sanitize(item.name) + '.png', await (await fetch(item.dataUrl)).blob());
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, (fileName.replace(/\.[^.]+$/, '') || 'icons') + '.zip');
  };

  return (
    <div className="relative pb-28">
      <ToolHeader
        title="图标拆分"
        description="上传图标拼合图，AI 自动拆分为独立 PNG"
      />

      <div className="space-y-4 px-4 py-4">
        <Dropzone onFile={handleFile} />

        {items.length > 0 && (
          <div className="rounded-[24px] bg-white p-4 shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#1e293b]">
                已拆出 <span className="text-indigo-600">{items.length}</span> 个图标
              </p>
              <button
                onClick={toggleAll}
                className="text-xs font-medium text-indigo-600"
              >
                {selected.size === items.length ? '全不选' : '全选'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {items.map((item, i) => (
                <div
                  key={i}
                  className="relative overflow-hidden rounded-2xl border border-slate-100"
                >
                  <button
                    onClick={() => toggle(i)}
                    className={`absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-md border text-[10px] text-white transition ${
                      selected.has(i)
                        ? 'border-indigo-600 bg-indigo-600'
                        : 'border-slate-300 bg-white/80 text-transparent'
                    }`}
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => downloadOne(item)}
                    title="下载该图标"
                    className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm"
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
                    <p className="truncate text-[12px] font-medium text-[#1e293b]">
                      {item.name}
                    </p>
                    <p className="text-[10px] text-[#94a3b8]">
                      {item.w}×{item.h}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="px-5 pb-2 text-center text-sm text-rose-500">{error}</p>
      )}
      {note && (
        <p className="px-5 pb-2 text-center text-xs text-amber-600">{note}</p>
      )}

      <BottomBar
        primaryLabel={source && items.length ? '重新拆分' : '开始拆分'}
        onPrimary={run}
        loading={loading}
        secondaryLabel={selected.size ? '打包下载 ZIP' : undefined}
        onSecondary={selected.size ? downloadAll : undefined}
      />

      {items.length === 0 && (
        <div className="flex items-center justify-center gap-1 px-4 pb-2 text-xs text-[#94a3b8]">
          <Plus className="h-3 w-3" />
          <span>拆分后可逐一或打包导出，背景自动透明</span>
          <PackageCheck className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}

function sanitize(name: string): string {
  const s = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').trim();
  return s || 'icon';
}
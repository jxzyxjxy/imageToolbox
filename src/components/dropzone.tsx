'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  onFile: (file: File) => void;
  accept?: string;
  hint?: string;
  className?: string;
  /** 选图后读取/预处理期间置 true，显示转圈反馈并禁止重复点击 */
  loading?: boolean;
  loadingLabel?: string;
}

export function Dropzone({
  onFile,
  accept = 'image/*',
  hint = '支持 JPG / PNG / WebP',
  className,
  loading = false,
  loadingLabel = '正在读取图片…',
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (loading) return;
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile, loading],
  );

  return (
    <div
      onClick={() => {
        if (!loading) inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        'group mx-auto mt-4 flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed border-indigo-200 bg-white px-6 py-12 text-center transition-colors',
        'hover:border-indigo-400 hover:bg-indigo-50/30',
        dragging && !loading && 'border-indigo-500 bg-indigo-50/60',
        loading && 'cursor-default border-indigo-300 bg-indigo-50/40',
        className,
      )}
    >
      {loading ? (
        <>
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#a855f7] text-white shadow-[0_10px_20px_rgba(99,102,241,0.3)]">
            <Loader2 className="h-8 w-8 animate-spin" />
          </span>
          <span className="text-[16px] font-semibold text-[#1e293b]">
            {loadingLabel}
          </span>
          <span className="text-[13px] text-[#94a3b8]">请稍候，不要退出页面</span>
        </>
      ) : (
        <>
          <span
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#a855f7] text-white shadow-[0_10px_20px_rgba(99,102,241,0.3)] transition-transform group-hover:scale-105',
              dragging && 'scale-110',
            )}
          >
            <UploadCloud className="h-8 w-8" />
          </span>
          <span className="text-[16px] font-semibold text-[#1e293b]">
            选择一张图片
          </span>
          <span className="text-[13px] text-[#94a3b8]">{hint}</span>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  onFile: (file: File) => void;
  accept?: string;
  /** 自定义提示语 */
  hint?: string;
  className?: string;
}

export default function Dropzone({
  onFile,
  accept = 'image/*',
  hint = '点击或拖拽图片到此处，支持 JPG / PNG / WebP',
  className,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
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
        'group flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-black/10 bg-white px-6 py-12 text-center transition-colors',
        'hover:border-black/30',
        dragging && 'border-blue-500 bg-blue-50/50',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.04] text-[#52525b] transition-transform group-hover:scale-105',
          dragging && 'scale-110 text-blue-500',
        )}
      >
        <UploadCloud className="h-6 w-6" />
      </span>
      <span className="text-sm font-medium text-[#3f3f46]">
        {dragging ? '松开即可上传' : '选择一张图片'}
      </span>
      <span className="text-xs text-[#a1a1aa]">{hint}</span>
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
    </button>
  );
}
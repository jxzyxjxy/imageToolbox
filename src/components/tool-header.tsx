'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

interface ToolHeaderProps {
  /** 标题（优先），兼容旧用法 name */
  title?: string;
  name?: string;
  description: string;
}

export function ToolHeader({ title, name, description }: ToolHeaderProps) {
  const heading = title ?? name ?? '';
  const router = useRouter();
  return (
    <header className="flex items-center gap-3 px-4 pt-5">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="返回"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#6366f1] shadow-[0_4px_14px_rgba(30,41,59,0.06)] transition-transform duration-200 active:scale-95"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 text-left">
        <h1 className="truncate text-[19px] font-bold leading-tight text-[#1e293b]">
          {heading}
        </h1>
        <p className="truncate text-[13px] text-[#64748b]">{description}</p>
      </div>
    </header>
  );
}
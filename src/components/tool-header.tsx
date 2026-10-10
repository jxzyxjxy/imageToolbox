import Link from 'next/link';
import { ChevronLeft, type LucideIcon } from 'lucide-react';

interface ToolHeaderProps {
  icon: LucideIcon;
  name: string;
  description: string;
  gradient: string;
  accentBg: string;
}

export default function ToolHeader({
  icon: Icon,
  name,
  description,
  gradient,
  accentBg,
}: ToolHeaderProps) {
  return (
    <>
      {/* 顶部返回栏 */}
      <div className="flex items-center justify-between px-0 pb-4 pt-2">
        <Link
          href="/"
          aria-label="返回首页"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.04] bg-white text-[#18181b] shadow-sm transition-colors active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <span className="text-[13px] font-semibold text-[#3f3f46]">{name}</span>
        <span className="w-10" />
      </div>

      {/* 工具标题区 */}
      <div className="mb-5 flex items-center gap-3.5 rounded-2xl border border-black/[0.04] bg-white/70 p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] backdrop-blur">
        <div
          className={`flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl p-3 ${accentBg} ring-1 ring-black/[0.03]`}
        >
          <Icon
            className={`h-6 w-6 bg-gradient-to-br ${gradient} bg-clip-text text-transparent`}
          />
        </div>
        <div>
          <h1 className="text-[17px] font-bold tracking-tight text-[#18181b]">{name}</h1>
          <p className="mt-0.5 text-[12px] leading-4 text-[#71717a]">{description}</p>
        </div>
      </div>
    </>
  );
}
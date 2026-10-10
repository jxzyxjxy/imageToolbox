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
    <div className="pb-8">
      <Link
        href="/"
        className="mb-5 inline-flex items-center gap-1 text-sm text-[#71717a] transition-colors hover:text-[#18181b]"
      >
        <ChevronLeft className="h-4 w-4" />
        返回首页
      </Link>
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${accentBg}`}>
          <Icon className={`h-6 w-6 bg-gradient-to-br ${gradient} bg-clip-text text-transparent`} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#18181b]">{name}</h1>
          <p className="mt-1.5 text-sm leading-6 text-[#71717a]">{description}</p>
        </div>
      </div>
    </div>
  );
}
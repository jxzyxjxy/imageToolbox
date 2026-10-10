import type { Metadata } from 'next';
import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { tools } from '@/lib/tools';

export const metadata: Metadata = {
  title: '图片工具箱',
  description: '掌上图片工具箱：AI证件照、智能抠图、图片压缩，本地处理隐私安全。',
};

export default function Home() {
  return (
    <>
      {/* Hero 品牌区：紫色渐变，底部圆角收边 + 白色光晕 */}
      <section className="relative overflow-hidden rounded-b-[28px] bg-gradient-to-br from-[#6366f1] via-[#8b5cf6] to-[#a855f7] px-5 pb-12 pt-9 text-center">
        <span className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-white/[0.12]" />
        <span className="pointer-events-none absolute -bottom-12 -left-10 h-40 w-40 rounded-full bg-white/[0.08]" />

        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-[20px] bg-white/[0.22] shadow-[0_10px_24px_rgba(99,102,241,0.45)]">
          <Wrench className="h-8 w-8 text-white" />
        </div>

        <h1 className="relative mt-5 text-[24px] font-extrabold leading-tight tracking-tight text-white">
          图片工具箱
        </h1>
        <p className="relative mx-auto mt-2 max-w-[250px] text-[13px] leading-5 text-white/[0.85]">
          一个小工具箱，搞定日常图片处理。上传即用，全程本地完成，安全又安心。
        </p>
      </section>

      {/* 工具网格 */}
      <section className="px-4 pb-14 pt-8">
        <p className="px-1 text-[13px] font-semibold text-[#94a3b8]">全部工具</p>

        <div className="mt-3 grid grid-cols-2 gap-3.5">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                className="relative flex flex-col items-center rounded-[20px] bg-white px-4 py-5 text-center shadow-[0_4px_16px_rgba(30,41,59,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(30,41,59,0.1)] active:scale-[0.97]"
              >
                <span className="absolute right-3 top-3 rounded-full bg-gradient-to-r from-[#6366f1] to-[#a855f7] px-2 py-0.5 text-[10px] font-semibold text-white">
                  可用
                </span>

                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${tool.gradient} shadow-[0_6px_14px_rgba(30,41,59,0.16)]`}
                >
                  <Icon className="h-6 w-6 text-white" />
                </div>

                <h3 className="mt-3 text-[15px] font-bold leading-tight text-[#1e293b]">
                  {tool.name}
                </h3>
                <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-[#64748b]">
                  {tool.description}
                </p>
              </Link>
            );
          })}

          {/* 占位工具卡 */}
          <div className="relative flex flex-col items-center rounded-[20px] bg-white px-4 py-5 text-center opacity-60 shadow-[0_4px_16px_rgba(30,41,59,0.06)]">
            <span className="absolute right-3 top-3 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-[#94a3b8]">
              敬请期待
            </span>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-200 to-slate-300">
              <span className="text-2xl font-light text-white">+</span>
            </div>
            <h3 className="mt-3 text-[15px] font-bold leading-tight text-[#1e293b]">
              更多工具
            </h3>
            <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-[#64748b]">
              新功能正在路上
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
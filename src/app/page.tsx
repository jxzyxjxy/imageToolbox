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
      {/* Hero 品牌区：满宽紫色渐变，底部 36px 圆角收边 */}
      <section className="relative overflow-hidden rounded-b-[36px] bg-gradient-to-br from-[#6366f1] via-[#8b5cf6] to-[#a855f7] px-6 pb-14 pt-12 text-center">
        {/* 半透明白色光晕装饰圆 */}
        <span className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/[0.12]" />
        <span className="pointer-events-none absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-white/[0.08]" />

        {/* Logo：88px 圆角方块，半透明白底 + 紫色投影 */}
        <div className="relative mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-[26px] bg-white/[0.22] shadow-[0_12px_30px_rgba(99,102,241,0.45)]">
          <Wrench className="h-10 w-10 text-white" />
        </div>

        {/* 标题与副标题 */}
        <h1 className="relative mt-6 text-[34px] font-extrabold leading-tight tracking-tight text-white">
          图片工具箱
        </h1>
        <p className="relative mx-auto mt-3 max-w-[280px] text-[15px] leading-6 text-white/[0.85]">
          一个工具箱，搞定常用图片处理。上传即用，全程在你的手机本地完成，安全又安心。
        </p>
      </section>

      {/* 工具网格：两列，间距 24px */}
      <section className="px-6 pb-12 pt-9">
        <div className="grid grid-cols-2 gap-6">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                className="relative flex flex-col items-center rounded-[28px] bg-white p-[32px_28px] text-center shadow-[0_4px_20px_rgba(30,41,59,0.06)] transition-transform duration-200 active:scale-[0.97]"
              >
                {/* 可用小标签（右上角） */}
                <span className="absolute right-4 top-4 rounded-full bg-gradient-to-r from-[#6366f1] to-[#a855f7] px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  可用
                </span>

                {/* 图标：76px 方块、22px 圆角、彩色渐变底 */}
                <div
                  className={`flex h-[76px] w-[76px] items-center justify-center rounded-[22px] bg-gradient-to-br ${tool.gradient} shadow-[0_8px_16px_rgba(30,41,59,0.16)]`}
                >
                  <Icon className="h-9 w-9 text-white" />
                </div>

                <h3 className="mt-5 text-[30px] font-bold leading-tight text-[#1e293b]">
                  {tool.name}
                </h3>
                <p className="mt-2 text-[22px] leading-snug text-[#64748b]">
                  {tool.description}
                </p>
              </Link>
            );
          })}

          {/* 占位工具卡：整体 0.62 透明度，右上角灰色「敬请期待」 */}
          <div className="relative flex flex-col items-center rounded-[28px] bg-white p-[32px_28px] text-center opacity-[0.62] shadow-[0_4px_20px_rgba(30,41,59,0.06)]">
            <span className="absolute right-4 top-4 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-[#94a3b8]">
              敬请期待
            </span>
            <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[22px] bg-gradient-to-br from-slate-200 to-slate-300 shadow-[0_8px_16px_rgba(30,41,59,0.16)]">
              <span className="text-3xl font-light text-white">+</span>
            </div>
            <h3 className="mt-5 text-[30px] font-bold leading-tight text-[#1e293b]">
              更多工具
            </h3>
            <p className="mt-2 text-[22px] leading-snug text-[#64748b]">
              新功能正在赶来的路上
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
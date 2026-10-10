import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Wrench } from 'lucide-react';
import { tools } from '@/lib/tools';

export const metadata: Metadata = {
  title: '图片工具箱',
  description: '掌上图片工具箱：AI证件照、智能抠图、图片压缩，本地处理隐私安全。',
};

export default function Home() {
  return (
    <>
      {/* 品牌栏 */}
      <div className="relative z-10 flex items-center gap-2 px-1 pb-5 pt-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-[#18181b] to-[#3f3f46] text-white shadow-sm">
          <Wrench className="h-[18px] w-[18px]" />
        </span>
        <div className="leading-tight">
          <p className="text-[15px] font-bold tracking-tight text-[#18181b]">图片工具箱</p>
          <p className="text-[11px] text-[#a1a1aa]">手机上一站式图片处理</p>
        </div>
      </div>

      {/* Hero */}
      <section className="relative z-10 px-1 pb-6">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-[#18181b]">
          一个工具箱，
          <br />
          搞定常用图片处理
        </h1>
        <p className="mt-2.5 max-w-[300px] text-[13px] leading-5 text-[#71717a]">
          上传即用，几秒钟完成证件照、抠图与压缩。所有处理都在你的手机本地完成，安全又安心。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {['AI 证件照', '智能抠图', '图片压缩'].map((t) => (
            <span
              key={t}
              className="rounded-full border border-black/5 bg-white/80 px-3 py-1 text-[11px] font-medium text-[#52525b]"
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* 工具网格 */}
      <section className="relative z-10">
        <div className="grid grid-cols-2 gap-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.slug}
                href={tool.status === 'ready' ? `/tools/${tool.slug}` : '#'}
                className={`group flex flex-col rounded-2xl border border-black/[0.04] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(16,24,40,0.08)] active:scale-[0.98] ${
                  tool.status === 'coming-soon' ? 'opacity-70' : ''
                }`}
              >
                <div
                  className={`mb-3.5 flex h-11 w-11 items-center justify-center rounded-2xl ${tool.accentBg} ring-1 ring-black/[0.03]`}
                >
                  <Icon
                    className={`h-[22px] w-[22px] bg-gradient-to-br ${tool.gradient} bg-clip-text text-transparent`}
                  />
                </div>
                <h3 className="text-[15px] font-semibold text-[#18181b]">{tool.name}</h3>
                <p className="mt-1 flex-1 text-[12px] leading-4 text-[#a1a1aa]">
                  {tool.description}
                </p>
              </Link>
            );
          })}

          {/* 占位卡：展示可扩展性 */}
          <div className="flex min-h-[128px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/10 bg-white/40 p-4 text-center">
            <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-black/[0.04] text-[#a1a1aa]">
              <Plus className="h-6 w-6" />
            </span>
            <p className="text-[13px] font-medium text-[#a1a1aa]">更多工具</p>
            <p className="mt-0.5 text-[11px] text-[#c4c4cc]">敬请期待</p>
          </div>
        </div>
      </section>

      {/* 底部提示 */}
      <p className="relative z-10 mt-8 text-center text-[11px] text-[#b6b9c6]">
        添加新工具只需在数据文件中追加一条配置
      </p>
    </>
  );
}
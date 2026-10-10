import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { tools } from '@/lib/tools';

export const metadata: Metadata = {
  title: '图片工具箱',
  description: '在线图片工具箱：AI 证件照、智能抠图、图片压缩，浏览器内即可完成。',
};

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="py-12 text-center sm:py-16">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium text-[#71717a]">
          免下载 · 免注册 · 浏览器内处理
        </span>
        <h1 className="mx-auto mt-5 max-w-2xl text-3xl font-bold tracking-tight text-[#18181b] sm:text-4xl">
          一个工具箱，搞定常用图片处理
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[#71717a] sm:text-base">
          上传照片，几秒钟完成证件照、抠图与压缩。图片全程在你的设备本地处理，安全又快捷。
        </p>
      </section>

      {/* Tools grid */}
      <section id="tools" className="pb-16">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#18181b]">全部工具</h2>
          <span className="text-xs text-[#a1a1aa]">共 {tools.length} 个</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.slug}
                href={tool.status === 'ready' ? `/tools/${tool.slug}` : '#'}
                className={`group relative flex flex-col rounded-2xl border border-black/5 bg-white p-6 transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-lg hover:shadow-black/5 ${
                  tool.status === 'coming-soon' ? 'opacity-70' : ''
                }`}
              >
                <div
                  className={`mb-5 flex h-12 w-12 items-center justify-center rounded-xl ${tool.accentBg}`}
                >
                  <Icon className={`h-6 w-6 bg-gradient-to-br ${tool.gradient} bg-clip-text text-transparent`} />
                </div>
                <h3 className="text-base font-semibold text-[#18181b]">
                  {tool.name}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-[#71717a]">
                  {tool.description}
                </p>
                <div className="mt-5 flex items-center gap-1 text-sm font-medium text-[#18181b]">
                  开始使用
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}
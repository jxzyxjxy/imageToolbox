import type { Metadata } from 'next';
import Link from 'next/link';
import { Wrench } from 'lucide-react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '图片工具箱 | Image Toolbox',
    template: '%s | 图片工具箱',
  },
  description:
    '一站式在线图片工具箱：AI 证件照、智能抠图、图片压缩，无需下载，浏览器内即可完成处理。',
  keywords: [
    '图片工具箱',
    'AI证件照',
    '证件照制作',
    '智能抠图',
    '去除背景',
    '图片压缩',
    '在线工具',
  ],
  authors: [{ name: 'Image Toolbox' }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#fafafa] text-[#18181b] antialiased">
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 sm:px-6">
          <header className="sticky top-0 z-40 border-b border-black/5 bg-[#fafafa]/80 backdrop-blur-md">
            <div className="flex h-14 items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-2.5 font-semibold text-[#18181b]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#18181b] text-white">
                  <Wrench className="h-4 w-4" />
                </span>
                <span className="text-[15px]">图片工具箱</span>
              </Link>
              <nav className="flex items-center gap-1 text-sm text-[#71717a]">
                <Link href="/" className="rounded-md px-3 py-1.5 hover:bg-black/5 hover:text-[#18181b]">
                  首页
                </Link>
                <a
                  href="#tools"
                  className="rounded-md px-3 py-1.5 hover:bg-black/5 hover:text-[#18181b]"
                >
                  全部工具
                </a>
              </nav>
            </div>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="border-t border-black/5 py-8 text-center text-xs text-[#a1a1aa]">
            <p>图片工具箱 · 所有图片均在本地浏览器处理，保障您的隐私安全</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
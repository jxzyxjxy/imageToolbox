import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '图片工具箱 | 手机图片工具合集',
    template: '%s | 图片工具箱',
  },
  description:
    '掌上图片工具箱：AI 证件照、智能抠图、图片压缩，全在浏览器本地完成，隐私安全。',
  keywords: ['图片工具箱', 'AI证件照', '智能抠图', '去除背景', '图片压缩', 'H5工具'],
  authors: [{ name: 'Image Toolbox' }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="bg-[#eef0f7] text-[#18181b] antialiased">
        {/* 手机界面容器：居中限宽，四周留出氛围背景 */}
        <div className="relative mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-gradient-to-b from-[#f5f7fd] via-[#fbfbfd] to-[#eef1fa] shadow-[0_0_60px_rgba(30,40,90,0.08)]">
          {/* 顶部柔光斑 */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-44 overflow-hidden">
            <div className="absolute -left-8 top-0 h-40 w-40 rounded-full bg-sky-200/40 blur-3xl" />
            <div className="absolute right-0 top-6 h-36 w-36 rounded-full bg-violet-200/40 blur-3xl" />
            <div className="absolute left-1/3 top-10 h-32 w-32 rounded-full bg-emerald-200/30 blur-3xl" />
          </div>

          <main className="relative z-10 flex-1 px-4 pb-6 pt-3">{children}</main>
        </div>
      </body>
    </html>
  );
}
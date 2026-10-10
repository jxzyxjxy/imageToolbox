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
      <body className="bg-[#f5f6fa] text-[#1e293b] antialiased">
        {/* 手机界面容器：居中限宽；内边距由各页面自行控制（Hero 需满宽） */}
        <div className="relative mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#f5f6fa]">
          {children}
        </div>
      </body>
    </html>
  );
}
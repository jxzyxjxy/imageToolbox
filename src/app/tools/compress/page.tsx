import type { Metadata } from 'next';
import CompressClient from './compress-client';

export const metadata: Metadata = {
  title: '图片压缩',
  description: '在线压缩图片，可调节质量与格式，实时预览对比体积。',
};

export default function CompressPage() {
  return <CompressClient />;
}
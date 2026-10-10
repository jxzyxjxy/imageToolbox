import type { Metadata } from 'next';
import IdPhotoClient from './id-photo-client';

export const metadata: Metadata = {
  title: 'AI 证件照',
  description: '上传照片，选择背景色与规格，一键生成标准证件照。',
};

export default function IdPhotoPage() {
  return <IdPhotoClient />;
}
import type { Metadata } from 'next';
import RemoveBgClient from './remove-bg-client';

export const metadata: Metadata = {
  title: '智能抠图',
  description: 'AI 一键去除图片背景，保留主体并导出透明 PNG。',
};

export default function RemoveBgPage() {
  return <RemoveBgClient />;
}
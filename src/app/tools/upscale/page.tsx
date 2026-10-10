import type { Metadata } from 'next';
import { UpscaleClient } from './upscale-client';

export const metadata: Metadata = {
  title: '高清放大 - 图片工具箱',
  description: '无损放大图片 2 至 4 倍并锐化细节，让模糊照片变高清。',
};

export default function UpscalePage() {
  return <UpscaleClient />;
}

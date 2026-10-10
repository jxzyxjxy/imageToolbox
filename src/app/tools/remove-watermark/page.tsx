import type { Metadata } from 'next';
import { RemoveWatermarkClient } from './remove-watermark-client';

export const metadata: Metadata = {
  title: '图片去水印 - 图片工具箱',
  description: '涂抹水印区域，AI 智能填补还原，去除文字、Logo 与印记。',
};

export default function RemoveWatermarkPage() {
  return <RemoveWatermarkClient />;
}

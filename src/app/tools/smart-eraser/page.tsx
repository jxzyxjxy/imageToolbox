import type { Metadata } from 'next';
import { SmartEraserClient } from './smart-eraser-client';

export const metadata: Metadata = {
  title: '智能消除 - 图片工具箱',
  description: '圈选多余的路人或杂物，一键无痕移除，让画面更干净。',
};

export default function SmartEraserPage() {
  return <SmartEraserClient />;
}

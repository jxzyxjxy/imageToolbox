import { Metadata } from 'next';
import IconSplitterClient from './icon-splitter-client';

export const metadata: Metadata = {
  title: '图标拆分',
  description: '上传图标拼合图 / 精灵图，AI 自动拆出每个图标并单独导出 PNG。',
};

export default function IconSplitterPage() {
  return <IconSplitterClient />;
}
// 工具注册表：新增工具只需在数组中追加一项，首页网格会自动渲染。
// 图标使用 lucide-react 组件。

import {
  ImageIcon,
  Scissors,
  FileArchive,
  Eraser,
  Wand2,
  ScanSearch,
  Sparkles,
  LayoutGrid,
  type LucideIcon,
} from 'lucide-react';

export interface ToolDef {
  /** 路由 slug，对应 /tools/{slug} */
  slug: string;
  name: string;
  /** 一句话说明 */
  description: string;
  /** 图标组件 */
  icon: LucideIcon;
  /** 工具强调色（图标渐变色类名） */
  gradient: string;
  /** 卡片 hover 时的浅色衬底 */
  accentBg: string;
  /** 状态：ready 可点击，coming-soon 占位 */
  status: 'ready' | 'coming-soon';
}

export const tools: ToolDef[] = [
  {
    slug: 'id-photo',
    name: 'AI 证件照',
    description: '上传照片，自由选择背景色与尺寸规格，一键生成标准证件照。',
    icon: ImageIcon,
    gradient: 'from-sky-500 to-blue-600',
    accentBg: 'bg-sky-50',
    status: 'ready',
  },
  {
    slug: 'remove-bg',
    name: '智能抠图',
    description: 'AI 一键去除背景，保留主体，导出透明 PNG，支持细节微调。',
    icon: Scissors,
    gradient: 'from-violet-500 to-indigo-600',
    accentBg: 'bg-violet-50',
    status: 'ready',
  },
  {
    slug: 'compress',
    name: '图片压缩',
    description: '可调压缩质量与预览对比，在体积与清晰度之间自由权衡。',
    icon: FileArchive,
    gradient: 'from-emerald-500 to-green-600',
    accentBg: 'bg-emerald-50',
    status: 'ready',
  },
  {
    slug: 'remove-watermark',
    name: '图片去水印',
    description: '涂抹水印区域，AI 智能填补还原，去除文字、Logo 与印记。',
    icon: Eraser,
    gradient: 'from-amber-500 to-orange-600',
    accentBg: 'bg-amber-50',
    status: 'ready',
  },
  {
    slug: 'smart-eraser',
    name: '智能消除',
    description: '圈选多余的路人或杂物，一键无痕移除，让画面更干净。',
    icon: Wand2,
    gradient: 'from-pink-500 to-rose-600',
    accentBg: 'bg-pink-50',
    status: 'ready',
  },
  {
    slug: 'upscale',
    name: '高清放大',
    description: '无损放大图片 2 至 4 倍并锐化细节，让模糊照片变高清。',
    icon: ScanSearch,
    gradient: 'from-cyan-500 to-teal-600',
    accentBg: 'bg-cyan-50',
    status: 'ready',
  },
  {
    slug: 'restore',
    name: '老照片修复',
    description: '修复模糊、划痕、褪色的老照片，AI 提清晰降噪，重焕高清细节。',
    icon: Sparkles,
    gradient: 'from-indigo-500 to-purple-600',
    accentBg: 'bg-indigo-50',
    status: 'ready',
  },
  {
    slug: 'icon-splitter',
    name: '图标拆分 · 雪碧图',
    description: '识别图片中每个 icon，智能高清、去除阴影，一键组合导出雪碧图。',
    icon: LayoutGrid,
    gradient: 'from-purple-500 to-fuchsia-600',
    accentBg: 'bg-purple-50',
    status: 'ready',
  },
];

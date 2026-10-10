// 工具注册表：新增工具只需在数组中追加一项，首页网格会自动渲染。
// 图标使用 lucide-react 组件。

import {
  ImageIcon,
  Scissors,
  FileArchive,
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
];
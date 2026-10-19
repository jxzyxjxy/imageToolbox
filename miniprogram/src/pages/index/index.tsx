import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

interface ToolItem {
  key: string;
  name: string;
  desc: string;
  icon: string;
  gradient: string;
  path?: string;
  ready: boolean;
}

const TOOLS: ToolItem[] = [
  {
    key: 'similar',
    name: '生成相似图',
    desc: 'AI 图生图，支持尺寸/相似度/透明背景',
    icon: '✨',
    gradient: 'linear-gradient(135deg, #6366f1, #a855f7)',
    path: '/pages/similar/index',
    ready: true,
  },
  {
    key: 'compress',
    name: '图片压缩',
    desc: '本地压缩，调节质量减小体积',
    icon: '🗜️',
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
    path: '/pages/compress/index',
    ready: true,
  },
  {
    key: 'restore',
    name: '老照片修复',
    desc: 'AI 修复模糊、划痕与褪色',
    icon: '🪄',
    gradient: 'linear-gradient(135deg, #f59e0b, #f97316)',
    path: '/pages/restore/index',
    ready: true,
  },
  {
    key: 'watermark',
    name: '去水印消除',
    desc: '涂抹消除水印与杂物',
    icon: '🧽',
    gradient: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
    ready: false,
  },
  {
    key: 'split',
    name: '图标拆分',
    desc: '合集图自动拆成单个图标',
    icon: '✂️',
    gradient: 'linear-gradient(135deg, #ec4899, #f43f5e)',
    ready: false,
  },
  {
    key: 'convert',
    name: '格式转换',
    desc: 'PNG / JPG / WebP 互转',
    icon: '🔄',
    gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    ready: false,
  },
];

export default function Index() {
  const handleTap = (tool: ToolItem) => {
    if (!tool.ready || !tool.path) {
      Taro.showToast({ title: '敬请期待', icon: 'none' });
      return;
    }
    Taro.navigateTo({ url: tool.path });
  };

  return (
    <View className="page">
      {/* Hero */}
      <View className="hero">
        <View className="hero__glow hero__glow--tr" />
        <View className="hero__glow hero__glow--bl" />
        <View className="hero__logo">
          <Text className="hero__logo-icon">🖼️</Text>
        </View>
        <Text className="hero__title">图片工具箱</Text>
        <Text className="hero__subtitle">AI 生图 · 压缩 · 修复，一站式图片处理</Text>
      </View>

      {/* 工具区 */}
      <View className="section">
        <Text className="section__title">全部工具</Text>
        <View className="grid">
          {TOOLS.map((tool) => (
            <View
              key={tool.key}
              className={`card ${tool.ready ? '' : 'card--disabled'}`}
              onClick={() => handleTap(tool)}
            >
              <View className="card__tag-wrap">
                {tool.ready ? (
                  <Text className="card__tag card__tag--ready">可用</Text>
                ) : (
                  <Text className="card__tag card__tag--soon">敬请期待</Text>
                )}
              </View>
              <View className="card__icon" style={{ background: tool.gradient }}>
                <Text className="card__icon-glyph">{tool.icon}</Text>
              </View>
              <Text className="card__name">{tool.name}</Text>
              <Text className="card__desc">{tool.desc}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

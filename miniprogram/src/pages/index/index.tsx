import { View, Text, Image } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import UserProfile from '@/components/UserProfile';
import { maybeShowInterstitialAd } from '@/utils/ad';
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
    key: 'id-photo',
    name: 'AI 证件照',
    desc: 'AI 抠图换底，一键生成标准证件照',
    icon: '🪪',
    gradient: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
    path: '/pages/id-photo/index',
    ready: true,
  },
  {
    key: 'remove-bg',
    name: '智能抠图',
    desc: 'AI 识别主体，一键去除背景',
    icon: '✂️',
    gradient: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
    path: '/pages/remove-bg/index',
    ready: true,
  },
  {
    key: 'compress',
    name: '图片压缩',
    desc: '自由调节压缩率，兼顾体积与清晰度',
    icon: '🗜️',
    gradient: 'linear-gradient(135deg, #10b981, #22c55e)',
    path: '/pages/compress/index',
    ready: true,
  },
  {
    key: 'remove-watermark',
    name: '图片去水印',
    desc: '涂抹标记水印区域，AI 无痕消除',
    icon: '🧽',
    gradient: 'linear-gradient(135deg, #f59e0b, #f97316)',
    path: '/pages/remove-watermark/index',
    ready: true,
  },
  {
    key: 'smart-eraser',
    name: '智能消除',
    desc: '圈选目标区域，无痕消除多余元素',
    icon: '🪄',
    gradient: 'linear-gradient(135deg, #ec4899, #f43f5e)',
    path: '/pages/smart-eraser/index',
    ready: true,
  },
  {
    key: 'upscale',
    name: '高清放大',
    desc: '2~4 倍放大并锐化细节，模糊照片变清晰',
    icon: '🔍',
    gradient: 'linear-gradient(135deg, #06b6d4, #14b8a6)',
    path: '/pages/upscale/index',
    ready: true,
  },
  {
    key: 'restore',
    name: '老照片修复',
    desc: '修复划痕、褪色与折痕，重现旧日色彩',
    icon: '🖼️',
    gradient: 'linear-gradient(135deg, #6366f1, #a855f7)',
    path: '/pages/restore/index',
    ready: true,
  },
  {
    key: 'similar',
    name: '生成相似图',
    desc: '参考原图风格与构图，生成多张相似图片',
    icon: '✨',
    gradient: 'linear-gradient(135deg, #d946ef, #a855f7)',
    path: '/pages/similar/index',
    ready: true,
  },
  // 未就绪的工具沉底展示：置灰 + 「敬请期待」标签 + 点击 toast；恢复时改回 true 并挪回上方即可
  {
    key: 'icon-splitter',
    name: '图标拆分',
    desc: '上传图标合集，拆成单张透明 PNG',
    icon: '🧩',
    gradient: 'linear-gradient(135deg, #a855f7, #d946ef)',
    path: '/pages/icon-splitter/index',
    ready: false,
  },
];

export default function Index() {
  // 进场插屏广告（已配置广告位 ID 时生效；每次冷启动最多一次）
  useDidShow(() => {
    setTimeout(() => maybeShowInterstitialAd(), 800);
  });

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
        <UserProfile />
        <View className="hero__logo">
          <Text className="hero__logo-icon">🖼️</Text>
        </View>
        <Text className="hero__title">青芽影图</Text>
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

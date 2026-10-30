import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

interface VideoToolItem {
  key: string;
  name: string;
  desc: string;
  icon: string;
  gradient: string;
  path?: string;
  ready: boolean;
}

const VIDEO_TOOLS: VideoToolItem[] = [
  {
    key: 'parse',
    name: '链接取回原片',
    desc: '粘贴分享链接，取回无水印原创视频',
    icon: '🔗',
    gradient: 'linear-gradient(135deg, #f59e0b, #f97316)',
    path: '/pages/video/parse/index',
    ready: true,
  },
  {
    key: 'compress',
    name: '视频压缩',
    desc: '缩小视频体积，保持清晰画质',
    icon: '🗜️',
    gradient: 'linear-gradient(135deg, #10b981, #22c55e)',
    path: '/pages/video/compress/index',
    ready: true,
  },
  // 未就绪工具置灰展示，恢复时改 ready 并保持在上方位即可
  {
    key: 'convert',
    name: '格式转换',
    desc: 'MP4 / MOV / AVI 等格式互转',
    icon: '🔄',
    gradient: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
    ready: false,
  },
  {
    key: 'audio',
    name: '音频提取',
    desc: '从视频中提取音频文件',
    icon: '🎵',
    gradient: 'linear-gradient(135deg, #8b5cf6, #d946ef)',
    ready: false,
  },
  {
    key: 'crop',
    name: '视频裁剪',
    desc: '按时间区间截取视频片段',
    icon: '✂️',
    gradient: 'linear-gradient(135deg, #ec4899, #f43f5e)',
    ready: false,
  },
  {
    key: 'subtitle',
    name: '字幕提取',
    desc: '识别并导出视频中的字幕',
    icon: '💬',
    gradient: 'linear-gradient(135deg, #06b6d4, #14b8a6)',
    ready: false,
  },
];

export default function VideoIndex() {
  const handleTap = (tool: VideoToolItem) => {
    if (!tool.ready || !tool.path) {
      Taro.showToast({ title: '敬请期待', icon: 'none' });
      return;
    }
    Taro.navigateTo({ url: tool.path });
  };

  return (
    <View className="page">
      {/* Hero：视频工具入口用紫→蓝渐变，与图片工具的纯紫形成同族区分 */}
      <View className="hero">
        <View className="hero__glow hero__glow--tr" />
        <View className="hero__glow hero__glow--bl" />
        <View className="hero__logo">
          <Text className="hero__logo-icon">🎬</Text>
        </View>
        <Text className="hero__title">视频工具</Text>
        <Text className="hero__subtitle">取回原片 · 压缩 · 处理，视频一站搞定</Text>
      </View>

      {/* 工具区 */}
      <View className="section">
        <Text className="section__title">全部工具</Text>
        <View className="grid">
          {VIDEO_TOOLS.filter((tool) => tool.ready).map((tool) => (
            <View
              key={tool.key}
              className="card"
              onClick={() => handleTap(tool)}
            >
              <View className="card__tag-wrap">
                <Text className="card__tag card__tag--ready">可用</Text>
              </View>
              <View className="card__icon" style={{ background: tool.gradient }}>
                <Text className="card__icon-glyph">{tool.icon}</Text>
              </View>
              <Text className="card__name">{tool.name}</Text>
              <Text className="card__desc">{tool.desc}</Text>
            </View>
          ))}
        </View>

        <Text className="section__title section__title--soon">即将上线</Text>
        <View className="grid">
          {VIDEO_TOOLS.filter((tool) => !tool.ready).map((tool) => (
            <View
              key={tool.key}
              className="card card--disabled"
              onClick={() => handleTap(tool)}
            >
              <View className="card__tag-wrap">
                <Text className="card__tag card__tag--soon">敬请期待</Text>
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

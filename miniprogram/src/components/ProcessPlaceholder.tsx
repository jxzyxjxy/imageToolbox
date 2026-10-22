import { View, Text } from '@tarojs/components';
import './ProcessPlaceholder.scss';

interface ProcessPlaceholderProps {
  /** 主文案，如「AI 正在生成相似图…」 */
  title: string;
  /** 副提示，如耗时说明 */
  desc?: string;
  /** 占位高度（rpx），默认 360 */
  height?: number;
}

/** 结果区生成中占位：旋转动画 + 分阶段文案，替代全屏 showLoading */
export default function ProcessPlaceholder({
  title,
  desc,
  height,
}: ProcessPlaceholderProps) {
  return (
    <View
      className="proc-ph"
      style={height ? { height: `${height}rpx` } : undefined}
    >
      <View className="proc-ph__spinner" />
      <Text className="proc-ph__title">{title}</Text>
      {!!desc && <Text className="proc-ph__desc">{desc}</Text>}
    </View>
  );
}

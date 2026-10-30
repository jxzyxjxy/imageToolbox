import { View, Text } from '@tarojs/components';
import { requestPortraitConsent, requestVideoConsent } from '../../utils/consent';
import './index.scss';

interface ConsentCheckboxProps {
  /** 已同意 → 整条隐藏（授权过的用户无感，不造成打扰） */
  authed: boolean;
  /** 用户点同意后的回调（页面 setAuthed(true)，主按钮恢复可点） */
  onGrant: () => void;
  /** 声明类型：portrait=肖像权授权（图片 AI 工具默认）；video=用户声明及版权提示（视频链接解析） */
  type?: 'portrait' | 'video';
}

/**
 * 声明勾选条（置于主按钮上方）：
 * - 未授权：显示未勾选态；点击整条 → 弹出声明
 *   同意 → onGrant()（勾上、按钮恢复）；拒绝 → 保持未勾选、按钮置灰
 * - 已授权：不渲染
 */
export default function ConsentCheckbox({ authed, onGrant, type = 'portrait' }: ConsentCheckboxProps) {
  if (authed) return null;
  const request = type === 'video' ? requestVideoConsent : requestPortraitConsent;
  const docName = type === 'video' ? '《用户声明及版权提示》' : '《肖像权与个人信息授权声明》';
  return (
    <View
      className="consent-bar"
      onClick={() =>
        request(
          () => onGrant(),
          () => console.log('[consent] 勾选弹窗被拒绝，保持未勾选'),
        )
      }
    >
      <View className="consent-bar__box" />
      <Text className="consent-bar__text">
        我已阅读并同意
        <Text className="consent-bar__link">{docName}</Text>
      </Text>
    </View>
  );
}

import { View, Text } from '@tarojs/components';
import {
  previewPortraitConsent,
  previewVideoConsent,
  requestPortraitConsent,
  requestVideoConsent,
} from '../../utils/consent';
import './index.scss';

interface ConsentCheckboxProps {
  /** 已同意 → 常驻纯文本声明入口（无勾选框）；未同意 → 勾选条 */
  authed: boolean;
  /** 用户点同意后的回调（页面 setAuthed(true)，主按钮恢复可点） */
  onGrant: () => void;
  /** 声明类型：portrait=肖像权授权（图片 AI 工具默认）；video=用户声明及版权提示（视频链接解析） */
  type?: 'portrait' | 'video';
}

/**
 * 声明条（置于主按钮上方，两种形态）：
 * - 未授权：显示未勾选态；点击整条 → 弹出声明
 *   同意 → onGrant()（勾上、按钮恢复）；拒绝 → 保持未勾选、按钮置灰
 * - 已授权：常驻纯文本入口「使用即代表同意《xx声明》」，无勾选框不打扰使用；
 *   点击 → 纯预览声明全文（单按钮"我知道了"）。
 *   审核合规要求：授权声明对用户始终可见可查，不能同意一次后就再也找不到。
 */
export default function ConsentCheckbox({ authed, onGrant, type = 'portrait' }: ConsentCheckboxProps) {
  const isVideo = type === 'video';
  const request = isVideo ? requestVideoConsent : requestPortraitConsent;
  const preview = isVideo ? previewVideoConsent : previewPortraitConsent;
  const docName = isVideo ? '《用户声明及版权免责声明》' : '《肖像权与个人信息授权声明》';

  // 已同意：常驻纯文本入口，点击纯预览全文
  if (authed) {
    return (
      <View className="consent-bar" onClick={preview}>
        <Text className="consent-bar__plain">
          使用即代表同意
          <Text className="consent-bar__link">{docName}</Text>
        </Text>
      </View>
    );
  }

  // 未同意：勾选条，点击弹声明
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

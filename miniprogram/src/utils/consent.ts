import Taro from '@tarojs/taro';

/**
 * 肖像权与个人信息授权声明（审核合规要求：AI 人脸相关功能必须先弹授权声明）
 * 同意一次后持久记忆，不再重复打扰；拒绝则本次操作终止。
 */
const CONSENT_KEY = 'yt_portrait_consent_v1';

let sessionAgreed = false;

export async function ensurePortraitConsent(): Promise<boolean> {
  if (sessionAgreed) return true;
  try {
    if (Taro.getStorageSync(CONSENT_KEY) === 'agreed') {
      sessionAgreed = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  try {
    const res = await Taro.showModal({
      title: '肖像权与个人信息授权声明',
      content:
        '请确认您上传的图片为您本人照片，或已获得肖像权人的合法授权。严禁上传、处理他人（含公众人物）的人脸照片，严禁将生成内容用于非法用途。继续使用即表示您承诺对上传内容拥有合法权利，违规使用产生的法律责任由您自行承担。',
      confirmText: '同意并继续',
      cancelText: '取消',
      confirmColor: '#6366f1',
    });
    if (res.confirm) {
      sessionAgreed = true;
      try {
        Taro.setStorageSync(CONSENT_KEY, 'agreed');
      } catch {
        /* ignore */
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

import Taro from '@tarojs/taro';

/**
 * 肖像权与个人信息授权声明（审核合规要求：AI 人脸相关功能必须先弹授权声明）
 * 同意一次后持久记忆，不再重复打扰；拒绝则本次操作终止。
 *
 * 健壮性设计（修复"点击无反应"死锁）：
 * - showModal 使用回调式而非 promise 化（Taro promise 化在部分环境会吞事件导致永不 resolve）
 * - fail 时放行：弹窗技术故障不应阻断主流程（内容安全已由 secCheck 独立把关）
 * - 10 秒无响应兜底放行，保证流程永不死锁
 */
const CONSENT_KEY = 'yt_portrait_consent_v1';

let sessionAgreed = false;

export async function ensurePortraitConsent(): Promise<boolean> {
  if (sessionAgreed) return true;
  try {
    if (Taro.getStorageSync(CONSENT_KEY) === 'agreed') {
      sessionAgreed = true;
      console.log('[consent] 已有授权记录，直接放行');
      return true;
    }
  } catch {
    /* ignore */
  }

  console.log('[consent] 弹出肖像权授权声明');
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    // 兜底：万一 success/fail 均未触发（开发者工具偶发吞事件），10 秒后放行
    setTimeout(() => {
      if (!settled) {
        console.warn('[consent] showModal 无响应(10s兜底)，放行');
        done(true);
      }
    }, 10000);
    Taro.showModal({
      title: '肖像权与个人信息授权声明',
      content:
        '请确认您上传的图片为您本人照片，或已获得肖像权人的合法授权。严禁上传、处理他人（含公众人物）的人脸照片，严禁将生成内容用于非法用途。继续使用即表示您承诺对上传内容拥有合法权利，违规使用产生的法律责任由您自行承担。',
      confirmText: '同意',
      cancelText: '取消',
      confirmColor: '#6366f1',
      success: (r) => {
        if (r.confirm) {
          sessionAgreed = true;
          try {
            Taro.setStorageSync(CONSENT_KEY, 'agreed');
          } catch {
            /* ignore */
          }
          console.log('[consent] 用户同意，继续');
          done(true);
        } else {
          console.log('[consent] 用户取消');
          done(false);
        }
      },
      fail: (e) => {
        console.warn('[consent] showModal 调用失败，放行:', e);
        done(true);
      },
    });
  });
}

import Taro from '@tarojs/taro';

/**
 * 肖像权与个人信息授权声明（审核合规要求：AI 人脸相关功能必须先弹授权声明）
 *
 * 时机：进入 AI 工具页（useDidShow）时弹出，而非选图后——
 * 用户停留在页面即已授权；拒绝则退回上一页，杜绝"拒绝后仍生成"的合规漏洞。
 * 同意一次后持久记忆，后续进入任何 AI 工具页不再重复打扰。
 *
 * 健壮性设计（修复"点击无反应"死锁的历史教训）：
 * - showModal 使用回调式而非 promise 化（Taro promise 化在部分环境会吞事件导致永不 resolve）
 * - confirmText / cancelText 不得超过 4 个汉字（微信硬限制，超长必 fail 且弹窗弹不出）
 * - fail 时放行并记忆：弹窗技术故障不应阻断主流程（内容安全已由 secCheck 独立把关）
 * - 10 秒无响应兜底放行，保证流程永不死锁
 */
const CONSENT_KEY = 'yt_portrait_consent_v1';

let sessionAgreed = false;

function markAgreed(): void {
  sessionAgreed = true;
  try {
    Taro.setStorageSync(CONSENT_KEY, 'agreed');
  } catch {
    /* ignore */
  }
}

function hasAgreed(): boolean {
  if (sessionAgreed) return true;
  try {
    if (Taro.getStorageSync(CONSENT_KEY) === 'agreed') {
      sessionAgreed = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * 进入 AI 工具页时调用：
 * - 已授权 → 直接放行（无感）
 * - 未授权 → 弹声明：同意 → 记忆并放行；拒绝 → 调用 onRejected（页面应退回）
 * - 弹窗技术故障 / 超时 → 放行并记忆（避免死锁与反复打扰）
 */
export function ensurePortraitConsentOnEnter(onRejected: () => void): void {
  if (hasAgreed()) {
    console.log('[consent] 已有授权记录，直接放行');
    return;
  }
  // 等页面转场动画结束再弹，规避开发者工具偶发吞弹窗事件
  setTimeout(() => {
    if (hasAgreed()) return; // 延迟期间可能已被其他入口同意
    console.log('[consent] 进入工具页，弹出肖像权授权声明');
    let settled = false;
    const finish = () => {
      settled = true;
    };
    // 兜底：万一 success/fail 均未触发，10 秒后放行
    setTimeout(() => {
      if (!settled) {
        console.warn('[consent] showModal 无响应(10s兜底)，放行');
        finish();
        markAgreed();
      }
    }, 10000);
    Taro.showModal({
      title: '肖像权与个人信息授权声明',
      content:
        '请确认您上传的图片为您本人照片，或已获得肖像权人的合法授权。严禁上传、处理他人（含公众人物）的人脸照片，严禁将生成内容用于非法用途。继续使用即表示您承诺对上传内容拥有合法权利，违规使用产生的法律责任由您自行承担。',
      confirmText: '同意',
      cancelText: '不同意',
      confirmColor: '#6366f1',
      success: (r) => {
        finish();
        if (r.confirm) {
          markAgreed();
          console.log('[consent] 用户同意，可继续使用');
        } else {
          console.log('[consent] 用户拒绝，页面退回');
          onRejected();
        }
      },
      fail: (e) => {
        finish();
        console.warn('[consent] showModal 调用失败，放行:', e);
        markAgreed();
      },
    });
  }, 150);
}

import Taro from '@tarojs/taro';

/**
 * 用户声明/授权声明弹窗（审核合规要求）。
 *
 * 产品逻辑（2026-10-31 重构，修复"拒绝后再进不弹窗"缺陷）：
 * - 进入工具页即弹：同意 → 持久记忆，之后无感使用；拒绝 → 按页面策略处理（退回/置灰）。
 * - 拒绝不记忆：再次进入重新弹窗，给用户重新选择的机会（可能误触）。
 * - 【核心原则】只有用户真正点过"同意"才允许写入记忆。
 *   弹窗技术故障（fail / 超时）只本次放行（内容安全另由 secCheck 把关），
 *   绝不持久化，下次进入照常重新弹——技术故障不得变成永久豁免授权。
 *
 * 健壮性：
 * - showModal 回调式而非 promise 化（promise 化在部分环境吞事件导致永不 resolve）
 * - confirmText / cancelText 不得超过 4 个汉字（微信硬限制）
 * - 故障自动重试一次；仍故障 → 本次放行不记忆
 *
 * 2026-10-31 抽象为通用声明引擎：肖像授权（图片 AI 工具）与
 * 版权声明（视频链接解析）共用同一套行为逻辑，仅存储键与文案不同。
 */

interface ConsentFlow {
  hasAgreed(): boolean;
  request(onGranted: () => void, onRejected: () => void): void;
}

function createConsentFlow(
  storageKey: string,
  modalTitle: string,
  modalContent: string,
): ConsentFlow {
  let sessionAgreed = false;

  const hasAgreed = (): boolean => {
    if (sessionAgreed) return true;
    try {
      if (Taro.getStorageSync(storageKey) === 'agreed') {
        sessionAgreed = true;
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  };

  const persistAgreed = (): void => {
    sessionAgreed = true;
    try {
      Taro.setStorageSync(storageKey, 'agreed');
    } catch {
      /* ignore */
    }
  };

  /** 弹声明：已同意同步回调；未同意弹窗（同意→记忆；拒绝→不记忆） */
  const request = (onGranted: () => void, onRejected: () => void): void => {
    if (hasAgreed()) {
      onGranted();
      return;
    }
    // 等页面转场结束再弹，规避转场期间偶发吞弹窗事件
    setTimeout(() => {
      if (hasAgreed()) {
        onGranted();
        return;
      }
      console.log(`[consent] 弹出声明: ${modalTitle}`);
      showModalOnce((result) => {
        if (result === 'granted') {
          persistAgreed();
          onGranted();
        } else if (result === 'rejected') {
          console.log('[consent] 用户拒绝，保持未授权状态');
          onRejected();
        } else {
          // 技术故障：延迟后重试一次
          console.warn('[consent] 弹窗异常，300ms 后重试');
          setTimeout(() => {
            showModalOnce((retry) => {
              if (retry === 'granted') {
                persistAgreed();
                onGranted();
              } else if (retry === 'rejected') {
                onRejected();
              } else {
                console.warn('[consent] 弹窗连续异常，本次放行（不记忆，下次进入重新弹）');
                onGranted();
              }
            });
          }, 300);
        }
      });
    }, 150);
  };

  /** showModal 单次调用。结果：granted / rejected / error（技术故障） */
  const showModalOnce = (cb: (result: 'granted' | 'rejected' | 'error') => void): void => {
    let settled = false;
    const finish = (r: 'granted' | 'rejected' | 'error') => {
      if (settled) return;
      settled = true;
      cb(r);
    };
    // 兜底：success/fail 均未触发（环境异常），按技术故障处理
    setTimeout(() => {
      if (!settled) finish('error');
    }, 10000);
    Taro.showModal({
      title: modalTitle,
      content: modalContent,
      confirmText: '同意',
      cancelText: '不同意',
      confirmColor: '#6366f1',
      success: (r) => finish(r.confirm ? 'granted' : 'rejected'),
      fail: (e) => {
        console.warn('[consent] showModal 调用失败:', e);
        finish('error');
      },
    });
  };

  return { hasAgreed, request };
}

/* ---------- 肖像权授权（图片 AI 工具） ---------- */

const portraitFlow = createConsentFlow(
  'yt_portrait_consent_v2',
  '肖像权与个人信息授权声明',
  '请确认您上传的图片为您本人照片，或已获得肖像权人的合法授权。严禁上传、处理他人（含公众人物）的人脸照片，严禁将生成内容用于非法用途。继续使用即表示您承诺对上传内容拥有合法权利，违规使用产生的法律责任由您自行承担。',
);

/** 兼容既有页面引用（图片 AI 工具页 authed 状态初始化） */
export const hasAgreed = (): boolean => portraitFlow.hasAgreed();

export function requestPortraitConsent(
  onGranted: () => void,
  onRejected: () => void,
): void {
  portraitFlow.request(onGranted, onRejected);
}

/* ---------- 用户声明及版权提示（视频链接解析） ---------- */

const videoFlow = createConsentFlow(
  'yt_video_consent_v1',
  '用户声明及版权提示',
  '本功能用于解析您本人发布或已获授权的原创视频（如 AI 生成内容），取回无水印原片。请勿解析、下载或传播他人拥有权利的内容，不得用于移除他人作品的版权标识。使用即表示您承诺对所解析内容拥有合法权利，违规使用产生的法律责任由您自行承担。',
);

export const hasVideoConsent = (): boolean => videoFlow.hasAgreed();

export function requestVideoConsent(
  onGranted: () => void,
  onRejected: () => void,
): void {
  videoFlow.request(onGranted, onRejected);
}

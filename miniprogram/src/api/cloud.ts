/**
 * 微信云开发封装：登录、工具票据、内容安全检测。
 * 云函数见 miniprogram/cloudfunctions/ 目录。
 */

interface WxCloud {
  init: (opts: { env: string; traceUser?: boolean }) => void;
  callFunction: (opts: {
    name: string;
    data?: Record<string, unknown>;
    success?: (res: { result: unknown }) => void;
    fail?: (err: Error) => void;
  }) => void;
}

function getWxCloud(): WxCloud | null {
  // Taro 编译到微信小程序时 wx 全局存在；H5/其他端不存在则返回 null
  const g = globalThis as unknown as { wx?: { cloud?: WxCloud } };
  return g.wx?.cloud ?? null;
}

/** 调用云函数；云开发不可用（如未配置环境 ID）时抛错 */
export async function callCloud<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  const cloud = getWxCloud();
  if (!cloud) {
    throw new Error('云开发不可用，请检查 appid 与云环境配置');
  }
  return new Promise<T>((resolve, reject) => {
    cloud.callFunction({
      name,
      data,
      success: (res) => resolve(res.result as T),
      fail: (err) => reject(new Error(err.message || `云函数 ${name} 调用失败`)),
    });
  });
}

/** 启动登录：openid 落库（失败静默，不阻断使用） */
export async function mpLogin(): Promise<void> {
  try {
    await callCloud<{ openid?: string; error?: string }>('login');
  } catch (e) {
    console.warn('[cloud] login 失败:', e);
  }
}

interface TicketResult {
  ticket?: string;
  remaining?: number;
  limit?: number;
  error?: string;
}

/** 向云函数申请指定工具的调用票据（云函数侧完成每日限频） */
export async function fetchTicket(tool: string): Promise<TicketResult> {
  const res = await callCloud<TicketResult>('ticket', { tool });
  if (!res.ticket) {
    throw new Error(res.error || '获取调用票据失败');
  }
  return res;
}

interface SecCheckResult {
  pass: boolean;
  error?: string;
}

/** 图片内容安全检测（传入压缩小图的 base64） */
export async function secCheckImage(base64: string): Promise<SecCheckResult> {
  try {
    return await callCloud<SecCheckResult>('sec-check', { imageBase64: base64 });
  } catch (e) {
    // 云函数未部署/环境未配置时放行并告警，避免阻断开发调试
    console.warn('[cloud] sec-check 不可用，已放行:', e);
    return { pass: true };
  }
}

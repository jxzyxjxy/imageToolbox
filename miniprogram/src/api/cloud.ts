/**
 * 微信云开发封装：登录、内容安全检测、云存储上传/下载/临时链接。
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
  uploadFile: (opts: {
    cloudPath: string;
    filePath: string;
    success?: (res: { fileID: string }) => void;
    fail?: (err: Error) => void;
  }) => void;
  downloadFile: (opts: {
    fileID: string;
    success?: (res: { tempFilePath: string }) => void;
    fail?: (err: Error) => void;
  }) => void;
  getTempFileURL: (opts: {
    fileList: string[];
    success?: (res: {
      fileList: { fileID: string; tempFileURL: string; status: number }[];
    }) => void;
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

/** 上传本地图片到云存储，返回 fileID（云函数凭 fileID 取图处理） */
export async function uploadImage(filePath: string): Promise<string> {
  const cloud = getWxCloud();
  if (!cloud) {
    throw new Error('云开发不可用，请检查 appid 与云环境配置');
  }
  const ext = (filePath.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase();
  const cloudPath = `inputs/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  return new Promise<string>((resolve, reject) => {
    cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => resolve(res.fileID),
      fail: (err) => reject(new Error(err.message || '图片上传失败')),
    });
  });
}

/** 下载云存储文件到本地临时路径（保存相册前调用） */
export async function downloadTemp(fileID: string): Promise<string> {
  const cloud = getWxCloud();
  if (!cloud) {
    throw new Error('云开发不可用，请检查 appid 与云环境配置');
  }
  return new Promise<string>((resolve, reject) => {
    cloud.downloadFile({
      fileID,
      success: (res) => resolve(res.tempFilePath),
      fail: (err) => reject(new Error(err.message || '结果图下载失败')),
    });
  });
}

/** fileID 批量换临时 HTTPS 链接（Image 组件直接展示用） */
export async function getTempUrls(fileIDs: string[]): Promise<Map<string, string>> {
  const cloud = getWxCloud();
  const map = new Map<string, string>();
  if (!cloud || fileIDs.length === 0) return map;
  return new Promise<Map<string, string>>((resolve) => {
    cloud.getTempFileURL({
      fileList: fileIDs,
      success: (res) => {
        for (const item of res.fileList || []) {
          if (item.status === 0 && item.tempFileURL) {
            map.set(item.fileID, item.tempFileURL);
          }
        }
        resolve(map);
      },
      fail: () => resolve(map),
    });
  });
}

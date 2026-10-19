import Taro from '@tarojs/taro';

/**
 * 后端服务地址（复用现有 Next.js 服务）。
 * - 开发调试：可用 http://服务器IP:5000，微信开发者工具需勾选
 *   「详情 → 本地设置 → 不校验合法域名」
 * - 正式发布：必须换成已完成 ICP 备案 + HTTPS 的域名，并在小程序
 *   后台「开发管理 → 服务器域名」配置为 request 合法域名
 */
export const BASE_URL = 'http://47.108.179.9:5000';

interface ApiError {
  error?: string;
}

/** POST JSON 并返回业务数据，非 200 或业务 error 时抛出 */
export async function post<T>(
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const res = await Taro.request({
    url: BASE_URL + path,
    method: 'POST',
    data,
    header: { 'Content-Type': 'application/json' },
    timeout: 180000,
  });
  const body = res.data as (T & ApiError) | undefined;
  if (res.statusCode !== 200) {
    throw new Error(body?.error || `请求失败（${res.statusCode}）`);
  }
  if (body && typeof body === 'object' && body.error) {
    throw new Error(body.error);
  }
  return body as T;
}

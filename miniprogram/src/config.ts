/**
 * 全局配置。
 * CLOUD_ENV：微信云开发环境 ID（在微信开发者工具「云开发」控制台开通后获取，
 *            形如 cloud1-2gxxxxxx）。发布后替换成正式环境 ID。
 * BASE_URL ：AI 计算服务（你的 ECS 上的 Next.js 服务）。
 *            开发期可用 http://IP:5000（开发者工具需勾选不校验合法域名）；
 *            正式发布必须换成 ICP 备案 + HTTPS 域名，并配置为 request 合法域名。
 */
export const CLOUD_ENV = 'your-cloud-env-id';

export const BASE_URL = 'http://47.108.179.9:5000';

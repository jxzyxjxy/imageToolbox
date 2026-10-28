/**
 * 全局配置。
 * CLOUD_ENV：微信云开发环境 ID（在微信开发者工具「云开发」控制台开通后获取，
 *            形如 cloud1-2gxxxxxx）。发布后替换成正式环境 ID。
 *
 * 小程序全部后端能力（登录/限频/内容安全/AI 生图/AI 抠图/图标拆分）
 * 均运行在微信云开发（云函数 + 云存储 + 云数据库），无任何自建服务器依赖。
 */
export const CLOUD_ENV = 'cloud1-d6ga4bn9we9abebf8';

/**
 * 插屏广告位 ID（进入首页时展示，每次冷启动最多一次）。
 * 获取路径：mp.weixin.qq.com → 流量主 → 广告位管理 → 新建「插屏广告」。
 * 流量主开通门槛：小程序累计独立访客（UV）≥ 1000。
 * 留空则广告自动停用（开发期保持为空即可）。
 */
export const AD_UNIT_INTERSTITIAL = '';

/**
 * 登录入口开关。false 时首页隐藏头像/登录入口与授权面板，
 * 全部功能游客可用。后续恢复登录功能改为 true 即可（UserProfile 组件保留）。
 */
export const SHOW_LOGIN_ENTRY = false;

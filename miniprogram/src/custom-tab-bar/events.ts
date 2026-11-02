/**
 * tabBar 通信事件。
 * 微信 custom tabBar 下每个 tab 页有独立的 tabBar 组件实例，且 Taro React 组件状态
 * 由 React 管理、原生 setData 桥接不可靠——因此选中态与切页动作全部走事件总线：
 * - TAB_SELECTED_EVENT：tab 页 onShow 时广播自己的索引，tabBar 组件监听后 setSelected
 * - TAB_NAVIGATE_EVENT：tabBar 组件点击时广播「目标路径 + 发起页索引」，
 *   由发起页（当前页）在自己的页面上下文内执行路由跳转——
 *   路由 API 只在页面上下文可靠（组件上下文中 switchTab 已证实 fail），
 *   且按发起页索引过滤，避免多个已加载的 tab 页监听器重复触发跳转。
 */
export const TAB_SELECTED_EVENT = 'ctab:selected';
export const TAB_NAVIGATE_EVENT = 'ctab:navigate';
export type TabIndex = 0 | 1;

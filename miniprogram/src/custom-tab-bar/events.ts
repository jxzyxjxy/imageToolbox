/**
 * tabBar 通信事件（仅剩导航一个）：
 *
 * - TAB_NAVIGATE_EVENT：tabBar 组件点击时广播「目标路径 + 发起页索引」，
 *   由发起页（当前页）在自己的页面上下文内执行路由跳转——
 *   路由 API 只在页面上下文可靠（组件上下文中 switchTab 已实测 fail），
 *   且按发起页索引过滤，避免多个已加载的 tab 页监听器重复触发跳转。
 *
 * 高亮不再需要事件同步：tabBar 实例创建时通过页面栈顶自知归属
 * （见 index.tsx 的 resolveSelfIndex），初始高亮即正确值。
 */
export const TAB_NAVIGATE_EVENT = 'ctab:navigate';

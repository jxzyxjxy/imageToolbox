/**
 * tabBar 通信事件：
 *
 * - TAB_NAVIGATE_EVENT：tabBar 组件点击时广播「目标路径 + 发起页索引」，
 *   由发起页（当前页）在自己的页面上下文内执行路由跳转——
 *   路由 API 只在页面上下文可靠（组件上下文中 switchTab 已实测 fail），
 *   且按发起页索引过滤，避免多个已加载的 tab 页监听器重复触发跳转。
 *
 * - TAB_SYNC_EVENT：tab 页每次 onShow 广播，tabBar 实例收到后重算自身高亮。
 *   必要性：tabBar 实例被框架缓存复用，切页不触发函数组件 re-render，
 *   render 期一次性计算的 selected 会冻结在旧值——一旦实例创建时
 *   页面栈尚未更新（竞态），高亮永久错位，且 idx===selected 早退
 *   与「目标页已是当前页的 switchTab 无变化」叠加成彻底死锁。
 *   onShow 同步在用户可点击之前必然发生，从机制上保证高亮正确。
 */
export const TAB_NAVIGATE_EVENT = 'ctab:navigate';
export const TAB_SYNC_EVENT = 'ctab:sync';

/**
 * tabBar 高亮同步事件（唯一通信事件）：
 *
 * - TAB_SYNC_EVENT：tab 页每次 onShow 广播，已加载的 tabBar 实例收到后
 *   重算自身高亮（读页面栈顶）。等价于官方自定义 tabBar 模式中页面
 *   onShow 里 getTabBar().setData({ selected }) 的 Taro React 写法——
 *   Taro React 函数组件拿不到 getTabBar 实例引用，用事件总线等价替代。
 *
 * 点击导航不走事件：组件点击处理器直接调 switchTabSafe（见 router.ts），
 * 不依赖任何状态判断，从结构上排除死锁。
 */
export const TAB_SYNC_EVENT = 'ctab:sync';

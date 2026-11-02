/**
 * tabBar 高亮同步事件。
 * 微信 custom tabBar 下每个 tab 页有独立的 tabBar 组件实例，且 Taro React 组件状态
 * 由 React 管理、原生 setData 桥接不可靠——因此选中态改由 Taro 事件总线同步：
 * tab 页 onShow 时 trigger 本事件，tabBar 组件监听后 setSelected（纯 React 链路）。
 */
export const TAB_SELECTED_EVENT = 'ctab:selected';
export type TabIndex = 0 | 1;

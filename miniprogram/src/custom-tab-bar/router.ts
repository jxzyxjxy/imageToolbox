import Taro from '@tarojs/taro';
import { TAB_SELECTED_EVENT } from './events';

/**
 * tab 页面上下文内执行 tabBar 页切换。
 *
 * 为什么必须在页面上下文调路由 API：custom-tab-bar 组件上下文中调用
 * Taro.switchTab / wx.switchTab 均会静默失败（Taro 4 已知坑），被迫走
 * reLaunch 重建页面栈兜底时首切明显变慢；而页面上下文的路由 API
 * （navigateTo / switchTab）全项目长期验证可靠。
 *
 * 通道设计：
 * 1. 主通道 Taro.switchTab（页面上下文标准用法）
 * 2. 兜底 reLaunch（可跳任意已注册页面，保证必切）
 * 3. 双失败：广播当前页索引，让 tabBar 高亮回滚到与页面一致
 */
export function switchTabFromPage(pagePath: string, selfIndex: 0 | 1): void {
  Taro.switchTab({
    url: pagePath,
    fail: (err: { errMsg?: string }) => {
      console.error('[ctab] switchTab fail, fallback to reLaunch:', pagePath, err?.errMsg);
      Taro.reLaunch({ url: pagePath }).catch((e: unknown) => {
        console.error('[ctab] reLaunch fail:', pagePath, e);
        // 双通道均失败才回滚高亮，保持与页面一致
        Taro.eventCenter.trigger(TAB_SELECTED_EVENT, selfIndex);
      });
    },
  });
}

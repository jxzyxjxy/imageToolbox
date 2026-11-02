import Taro from '@tarojs/taro';
import { TAB_SELECTED_EVENT } from './events';

/**
 * tab 页面上下文内执行 tabBar 页切换。
 *
 * 为什么必须在页面上下文调路由 API：custom-tab-bar 组件上下文中调用
 * Taro.switchTab / wx.switchTab 均会静默失败；页面上下文的路由 API
 * （navigateTo / switchTab）全项目长期验证可靠。
 *
 * 异常兜底设计（任何一层失败都有下一层接住，最终保证高亮与页面一致）：
 * 1. 主通道 Taro.switchTab（页面上下文标准用法）
 * 2. 同步异常 / fail 回调 → 降级 reLaunch（可跳任意已注册页面，保证必切）
 * 3. reLaunch 失败（异步 catch / 同步异常）→ 广播当前页索引，
 *    让 tabBar 高亮回滚到与页面一致，杜绝「页面没切、高亮却变了」的错位
 */
export function switchTabFromPage(pagePath: string, selfIndex: 0 | 1): void {
  const rollback = () => {
    Taro.eventCenter.trigger(TAB_SELECTED_EVENT, selfIndex);
  };

  const tryRelaunch = (reason: unknown) => {
    console.error('[ctab] switchTab fail, fallback to reLaunch:', pagePath, reason);
    try {
      Taro.reLaunch({ url: pagePath }).catch((e: unknown) => {
        console.error('[ctab] reLaunch fail:', pagePath, e);
        rollback();
      });
    } catch (e) {
      console.error('[ctab] reLaunch sync error:', pagePath, e);
      rollback();
    }
  };

  try {
    Taro.switchTab({
      url: pagePath,
      fail: (err: { errMsg?: string }) => {
        tryRelaunch(err?.errMsg ?? err);
      },
    });
  } catch (e) {
    // Taro.switchTab 同步抛异常时 fail 回调不会触发，必须在此接住
    tryRelaunch(e);
  }
}

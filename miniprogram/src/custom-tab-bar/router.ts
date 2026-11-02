import Taro from '@tarojs/taro';

/**
 * tab 页面上下文内执行 tabBar 页切换。
 *
 * 为什么必须在页面上下文调路由 API：custom-tab-bar 组件上下文中调用
 * Taro.switchTab / wx.switchTab 均会实测静默失败；而页面上下文的路由 API
 * （navigateTo / switchTab）全项目长期验证可靠。
 *
 * 异常兜底设计（任何一层失败都有下一层接住）：
 * 1. 主通道 Taro.switchTab（页面上下文标准用法）
 * 2. 同步异常 / fail 回调 → 降级 reLaunch（可跳任意已注册页面，保证必切）
 * 3. 全程 console.error 带 [ctab] 前缀，失败可在控制台直接定位到层
 *
 * 高亮无需回滚：tabBar 实例自知归属（见 index.tsx resolveSelfIndex），
 * 未切页时当前实例的高亮本来就是正确值。
 */
export function switchTabFromPage(pagePath: string): void {
  const tryRelaunch = (reason: unknown) => {
    console.error('[ctab] switchTab fail, fallback to reLaunch:', pagePath, reason);
    try {
      Taro.reLaunch({ url: pagePath }).catch((e: unknown) => {
        console.error('[ctab] reLaunch fail:', pagePath, e);
        // 用户可见的失败信号（不用翻控制台就能知道切换失败并重试）
        Taro.showToast({ title: '页面切换失败，请重试', icon: 'none', duration: 2000 });
      });
    } catch (e) {
      console.error('[ctab] reLaunch sync error:', pagePath, e);
      Taro.showToast({ title: '页面切换失败，请重试', icon: 'none', duration: 2000 });
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

import Taro from '@tarojs/taro';

/**
 * tab 页切换（带兜底）。
 *
 * wx.switchTab 是全局 API，页面/组件任何上下文均可直接调用。
 * （历史备注：早期版本曾认定「组件上下文调路由 API 不可靠」并引入
 * 事件总线转发到页面上下文执行——后证实是误诊，当时的真实原因是
 * 组件缺少 component 声明导致点击处理器根本没触发。该间接链路已删除。）
 *
 * 异常兜底：switchTab 同步异常 / fail 回调 → 降级 reLaunch（可跳任意
 * 已注册页面，保证必切）；再失败给用户可见提示。全程 [ctab] 前缀日志。
 */
export function switchTabSafe(pagePath: string): void {
  const tryRelaunch = (reason: unknown) => {
    console.error('[ctab] switchTab fail, fallback to reLaunch:', pagePath, reason);
    try {
      Taro.reLaunch({ url: pagePath }).catch((e: unknown) => {
        console.error('[ctab] reLaunch fail:', pagePath, e);
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
    // 同步抛异常时 fail 回调不会触发，必须在此接住
    tryRelaunch(e);
  }
}

import { View, Image, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { TAB_ICONS } from './custom-tab-bar.icons';
import { TAB_SYNC_EVENT } from './events';
import { switchTabSafe } from './router';
import './index.scss';

interface TabItem {
  pagePath: string; // 以 / 开头的跳转路径
  text: string;
  icon: string;
  iconActive: string;
}

const TABS: TabItem[] = [
  {
    pagePath: '/pages/index/index',
    text: '图片工具',
    icon: TAB_ICONS['pic-off'],
    iconActive: TAB_ICONS['pic-on'],
  },
  {
    pagePath: '/pages/video/index/index',
    text: '视频工具',
    icon: TAB_ICONS['video-off'],
    iconActive: TAB_ICONS['video-on'],
  },
];

/**
 * 解析本 tabBar 实例当前应高亮的 tab 索引：读页面栈顶路由。
 */
function resolveSelfIndex(): number {
  try {
    const pages = Taro.getCurrentPages();
    const route = pages[pages.length - 1]?.route ?? '';
    const hit = TABS.findIndex((t) => t.pagePath === `/${route}`);
    return hit >= 0 ? hit : 0;
  } catch {
    return 0;
  }
}

/**
 * 自定义 tabBar（标准实现，v3）：
 *
 * 1. 点击 = 恒定直接跳转。点击处理器只做一件事：switchTab 到目标页，
 *    不依赖本地高亮状态做任何判断或早退（wx.switchTab 是全局 API，任何
 *    上下文可调）。高亮仅是展示层——即使状态意外过期，点击依然完成真实
 *    跳转，跳转触发目标页 onShow → 高亮同步自愈。结构上排除
 *    「点了没反应」的全部死锁路径（此前 v1/v2 的死锁根因正是：
 *    早退判断依赖过期的本地状态 + 跳转经事件总线间接转发）。
 *
 * 2. 高亮 = 展示时校正。两个时机保证显示前必被纠正：
 *    a) 组件挂载时立即重算一次（覆盖「组件创建晚于页面 onShow 广播」、
 *       错过同步事件的时序）；
 *    b) 监听 TAB_SYNC_EVENT：tab 页每次 onShow 广播，实例重算高亮
 *      （等价于官方 getTabBar().setData 的 Taro React 写法）。
 *
 * 3. 图标 base64 内联（官方 tabBar 图标文件加载在本环境实测裂图）。
 */
export default function CustomTabBar() {
  const [selected, setSelected] = useState(() => resolveSelfIndex());

  useEffect(() => {
    // 挂载即自校：覆盖组件创建晚于 onShow 广播、错过同步事件的时序
    setSelected(resolveSelfIndex());
    const sync = () => setSelected(resolveSelfIndex());
    Taro.eventCenter.on(TAB_SYNC_EVENT, sync);
    return () => {
      Taro.eventCenter.off(TAB_SYNC_EVENT, sync);
    };
  }, []);

  const handleTap = (pagePath: string) => {
    // 恒定导航，不判断不早退：点到当前页时 switchTab 为无害 no-op
    switchTabSafe(pagePath);
  };

  return (
    <View className='ctab'>
      {TABS.map((tab, i) => (
        <View key={tab.pagePath} className='ctab__item' onClick={() => handleTap(tab.pagePath)}>
          <Image
            className='ctab__icon'
            src={i === selected ? tab.iconActive : tab.icon}
            mode='aspectFit'
          />
          <Text className={'ctab__text' + (i === selected ? ' ctab__text--on' : '')}>
            {tab.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

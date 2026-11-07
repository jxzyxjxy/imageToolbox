import { View, Image, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { TAB_ICONS } from './custom-tab-bar.icons';
import { TAB_NAVIGATE_EVENT, TAB_SYNC_EVENT } from './events';
import './index.scss';

interface TabItem {
  pagePath: string; // 以 / 开头的跳转路径
  route: string; // 不带 / 的注册路径（与 getCurrentPages 的 route 对齐）
  text: string;
  icon: string;
  iconActive: string;
}

const TABS: TabItem[] = [
  {
    pagePath: '/pages/index/index',
    route: 'pages/index/index',
    text: '图片工具',
    icon: TAB_ICONS['pic-off'],
    iconActive: TAB_ICONS['pic-on'],
  },
  {
    pagePath: '/pages/video/index/index',
    route: 'pages/video/index/index',
    text: '视频工具',
    icon: TAB_ICONS['video-off'],
    iconActive: TAB_ICONS['video-on'],
  },
];

/**
 * 解析本 tabBar 实例当前应高亮的 tab 索引：读页面栈顶路由。
 * tabBar 组件挂在页面上下文中，栈顶即当前显示的页面。
 */
function resolveSelfIndex(): number {
  try {
    const pages = Taro.getCurrentPages();
    const route = pages[pages.length - 1]?.route ?? '';
    const hit = TABS.findIndex((t) => t.route === route);
    return hit >= 0 ? hit : 0;
  } catch {
    return 0;
  }
}

/**
 * 自定义 tabBar：官方 tabBar 的图标文件加载（png/jpg 各种编码形态）在本环境实测全部裂图，
 * 改为组件自绘 + base64 内联图标，从机制上消除文件加载环节。
 *
 * 高亮（事件驱动，v2）：tab 页每次 onShow 广播 TAB_SYNC_EVENT，本实例重算
 * resolveSelfIndex 并 setState。不能只靠 render 期一次计算——tabBar 实例被
 * 框架缓存复用，切页不触发函数组件 re-render，一次性值会冻结在旧值：
 * 实例创建时若页面栈尚未更新（竞态），高亮永久错位，叠加「idx===selected
 * 早退」与「switchTab 到当前页无变化」形成死锁（点击完全无反应）。
 * onShow 同步必然先于用户点击发生，保证 selected 始终正确。
 *
 * 切页：广播导航事件（带发起页索引），由发起页在页面上下文内执行路由跳转
 * （组件上下文调路由 API 已实测不可靠），见 router.ts。
 */
export default function CustomTabBar() {
  const [selected, setSelected] = useState(() => resolveSelfIndex());

  useEffect(() => {
    // tab 页 onShow 广播：重算高亮，纠正冻结的旧值（含实例创建竞态导致的错位）
    const sync = () => setSelected(resolveSelfIndex());
    Taro.eventCenter.on(TAB_SYNC_EVENT, sync);
    return () => {
      Taro.eventCenter.off(TAB_SYNC_EVENT, sync);
    };
  }, []);

  const handleTap = (idx: number, pagePath: string) => {
    if (idx === selected) return;
    // 切页动作广播给页面上下文执行（组件上下文调路由 API 实测不可靠）。
    // 第三参数必须是「发起页索引」（即 selected/实例归属）：页面监听方以
    // fromIndex === 自身索引 过滤、只执行自己页发起的跳转——若误传目标 idx，
    // 发起页会被自己的过滤逻辑拒绝，而目标页尚未加载无监听者，事件落空（完全无反应）。
    // 导航失败时高亮不动——高亮与页面一致性天然保持，无需回滚
    Taro.eventCenter.trigger(TAB_NAVIGATE_EVENT, pagePath, selected);
  };

  return (
    <View className='ctab'>
      {TABS.map((tab, i) => (
        <View key={tab.pagePath} className='ctab__item' onClick={() => handleTap(i, tab.pagePath)}>
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

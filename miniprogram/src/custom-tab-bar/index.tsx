import { View, Image, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { TAB_ICONS } from './custom-tab-bar.icons';
import { TAB_NAVIGATE_EVENT } from './events';
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
 * 解析本 tabBar 实例所属的 tab 索引：组件创建时读取页面栈顶——
 * custom tabBar 组件挂在页面上下文中创建，此时栈顶即自己所在的页面。
 *
 * 这是高亮机制的唯一事实来源：实例自知归属，初始高亮即正确值，
 * 无需任何跨实例同步——历史上基于「页面 onShow 广播 + 组件监听」的同步
 * 存在必然时序竞态（onShow 先于 tabBar 组件 mount，事件无人接收，
 * 实例保持初始值导致高亮与页面错位），本方案从机制上消除该竞态。
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
 * 高亮：实例自知归属（resolveSelfIndex），只读；点击后页面切换，
 * 由目标页的新实例呈现正确高亮——不存在「当前实例高亮被同步」的需求。
 * 切页：广播导航事件（带发起页索引），由发起页在页面上下文内执行路由跳转
 * （组件上下文调路由 API 已实测不可靠），见 router.ts。
 */
export default function CustomTabBar() {
  const [selected] = useState(resolveSelfIndex);

  const handleTap = (idx: number, pagePath: string) => {
    // 带上发起页索引，监听方只允许发起页执行跳转，避免多个 tab 页监听器重复触发
    Taro.eventCenter.trigger(TAB_NAVIGATE_EVENT, pagePath, idx);
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

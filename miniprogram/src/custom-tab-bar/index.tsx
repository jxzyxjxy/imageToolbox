import { View, Image, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { TAB_ICONS } from './custom-tab-bar.icons';
import { TAB_SELECTED_EVENT, TAB_NAVIGATE_EVENT } from './events';
import './index.scss';

interface TabItem {
  pagePath: string;
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
 * 自定义 tabBar：原生 tabBar 的图标资源加载在某些环境始终裂图（PNG 形态/路径解析均已排除），
 * 改为组件自绘 + base64 内联图标，从机制上消除图标加载环节。
 *
 * 高亮同步机制：微信 custom tabBar 下每个 tab 页持有独立组件实例，且 Taro React 组件状态
 * 由 React 管理、原生 setData 桥接不可靠——因此各 tab 页 onShow 时通过事件总线广播选中索引，
 * 本组件监听后走纯 React setSelected 更新，与图标渲染同链路，杜绝高亮与页面错位。
 * 切页动作同样走事件总线：本组件点击后广播「目标路径 + 发起页索引」，
 * 由发起页在页面上下文内执行路由跳转（组件上下文调路由 API 已证实不可靠）。
 */
export default function CustomTabBar() {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const sync = (idx: number) => setSelected(idx);
    Taro.eventCenter.on(TAB_SELECTED_EVENT, sync);
    return () => {
      Taro.eventCenter.off(TAB_SELECTED_EVENT, sync);
    };
  }, []);

  const handleSwitch = (idx: number, pagePath: string) => {
    if (idx === selected) return;
    // 高亮先走（快速反馈），切页动作广播给页面上下文执行（组件上下文调路由 API 不可靠）；
    // 带上发起页索引，监听方只允许发起页执行跳转，避免多个 tab 页监听器重复触发。
    setSelected(idx);
    Taro.eventCenter.trigger(TAB_NAVIGATE_EVENT, pagePath, idx);
  };

  return (
    <View className='ctab'>
      {TABS.map((tab, i) => (
        <View
          key={tab.pagePath}
          className='ctab__item'
          onClick={() => handleSwitch(i, tab.pagePath)}
        >
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

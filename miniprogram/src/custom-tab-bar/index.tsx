import { View, Image, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { TAB_ICONS } from './custom-tab-bar.icons';
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
 * 选中态由各 tab 页 onShow 时通过 Taro.getTabBar(page).setState 同步。
 */
export default function CustomTabBar() {
  const [selected, setSelected] = useState(0);

  const handleSwitch = (idx: number, pagePath: string) => {
    if (idx === selected) return;
    setSelected(idx);
    Taro.switchTab({ url: pagePath });
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

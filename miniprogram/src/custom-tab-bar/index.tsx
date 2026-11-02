import { View, Image, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { TAB_ICONS } from './custom-tab-bar.icons';
import './index.scss';

/**
 * 微信原生路由 API。
 * Taro 包装层（Taro.switchTab）在 custom-tab-bar 组件上下文内调用不生效（Taro 4 已知坑），
 * 必须直调 wx.switchTab，这里给出最小类型声明。
 */
declare const wx: {
  switchTab: (opts: {
    url: string;
    success?: () => void;
    fail?: (err: { errMsg: string }) => void;
  }) => void;
};

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
 * 选中态由各 tab 页 onShow 时通过 Taro.getTabBar(page).setData 同步。
 */
export default function CustomTabBar() {
  const [selected, setSelected] = useState(0);

  const handleSwitch = (idx: number, pagePath: string) => {
    if (idx === selected) return;
    const prev = selected;
    setSelected(idx);
    // 主通道：原生 wx.switchTab（custom tabBar 组件上下文内最可靠）
    wx.switchTab({
      url: pagePath,
      fail: (err: { errMsg: string }) => {
        console.error('[ctab] switchTab fail, fallback to reLaunch:', pagePath, err);
        // 兜底通道：reLaunch 可跳任意已注册页面（含 tabBar 页），保证页面必切
        Taro.reLaunch({ url: pagePath }).catch((e: unknown) => {
          console.error('[ctab] reLaunch fail:', pagePath, e);
          // 双通道均失败才回滚高亮，保持与页面一致
          setSelected(prev);
        });
      },
    });
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

import { View, Text, Image, Button, Input } from '@tarojs/components';
import Taro, { useDidShow, useShareAppMessage } from '@tarojs/taro';
import { useState } from 'react';
import { TAB_SYNC_EVENT } from '@/custom-tab-bar/events';
import './index.scss';

/** 本地登录态（头像为用户目录持久化路径，昵称为微信昵称键盘填写） */
const PROFILE_KEY = 'yt_profile_v1';
/** 清除缓存时保留的键前缀：登录态 + 两类授权声明记忆（清完不用重登、重新弹声明） */
const KEEP_PREFIXES = ['yt_profile', 'yt_portrait_consent', 'yt_video_consent'];
const APP_VERSION = '1.0.0';

interface UserProfile {
  avatar: string;
  nickname: string;
}

function loadProfile(): UserProfile | null {
  try {
    const p = Taro.getStorageSync(PROFILE_KEY) as Partial<UserProfile> | '';
    if (p && p.avatar && p.nickname) return { avatar: p.avatar, nickname: p.nickname };
    return null;
  } catch {
    return null;
  }
}

/** 默认头像（base64 灰色人形，与 tabBar 图标同风格） */
const DEFAULT_AVATAR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAyCAYAAADsg90UAAAAq0lEQVR4nO3XMQ6EMAxEUd+/5gZcgtuxQsgdEiwkcez5I9Hnv4bEjDHGGAvbsm579BmG7gi++6LP2G1P4ssi/BNfDuFNfBmEL/ElEAAAQBigRTwImeMNAAAAMPWboE863icd75OOv5pcMFOc7G+wxSUoLUTL+HQIPeLTIPSMT4EgDTAiflqEkfFTIgAAAAC6ABHxIMwUbwAAAIA8gKm/BXzS8QbAOel4X5b4HyD3usR3LmzTAAAAAElFTkSuQmCC';

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(() => loadProfile());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ avatar: string; nickname: string }>({ avatar: '', nickname: '' });

  // 广播 tabBar 高亮同步（见 custom-tab-bar/events.ts 说明）
  useDidShow(() => {
    Taro.eventCenter.trigger(TAB_SYNC_EVENT);
    setProfile(loadProfile());
  });

  // 右上角菜单/主动转发均走这里
  useShareAppMessage(() => ({
    title: '青芽影图 - 图片视频小工具箱',
    path: '/pages/index/index',
  }));

  /** 打开资料编辑（登录 / 修改） */
  const openEditor = () => {
    setDraft({
      avatar: profile?.avatar ?? '',
      nickname: profile?.nickname ?? '',
    });
    setEditing(true);
  };

  /** chooseAvatar 返回临时文件，复制到用户目录持久化（临时路径会话后会失效） */
  const handleChooseAvatar = async (e: { detail: { avatarUrl: string } }) => {
    const tmp = e.detail.avatarUrl;
    try {
      const dst = `${Taro.env.USER_DATA_PATH}/profile_avatar.png`;
      const fsm = Taro.getFileSystemManager();
      try {
        fsm.unlinkSync(dst);
      } catch {
        /* 首次无旧文件，忽略 */
      }
      fsm.copyFileSync(tmp, dst);
      setDraft((d) => ({ ...d, avatar: dst }));
    } catch {
      // 复制失败兜底：直接用临时路径（本次会话内仍可用）
      setDraft((d) => ({ ...d, avatar: tmp }));
    }
  };

  const handleNicknameInput = (e: { detail: { value: string } }) => {
    setDraft((d) => ({ ...d, nickname: e.detail.value }));
  };

  const handleSave = () => {
    if (!draft.avatar) {
      Taro.showToast({
        title: '请先点上方头像选微信头像；若无反应请在小程序设置中同意隐私协议',
        icon: 'none',
        duration: 3000,
      });
      return;
    }
    const nickname = draft.nickname.trim();
    if (!nickname) {
      Taro.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    const next = { avatar: draft.avatar, nickname };
    try {
      Taro.setStorageSync(PROFILE_KEY, next);
    } catch {
      /* storage 写失败时内存态仍生效 */
    }
    setProfile(next);
    setEditing(false);
    Taro.showToast({ title: '登录成功', icon: 'success' });
  };

  /** 清除缓存：保留登录态与授权声明记忆，其余全清 */
  const handleClearCache = () => {
    Taro.showModal({
      title: '清除缓存',
      content: '将清除使用过程中产生的临时数据，不影响登录状态和授权记录，确定清除吗？',
      confirmText: '清除',
      confirmColor: '#6366f1',
      success: (res) => {
        if (!res.confirm) return;
        try {
          const { keys } = Taro.getStorageInfoSync();
          const doomed = keys.filter(
            (k) => !KEEP_PREFIXES.some((p) => k.startsWith(p)),
          );
          doomed.forEach((k) => Taro.removeStorageSync(k));
          Taro.showToast({
            title: doomed.length ? `已清除 ${doomed.length} 项缓存` : '缓存已是最新',
            icon: 'none',
          });
        } catch {
          Taro.showToast({ title: '清除失败，请重试', icon: 'none' });
        }
      },
    });
  };

  /** 退出登录：清空本地登录态，恢复游客态 */
  const handleLogout = () => {
    if (!profile) {
      Taro.showToast({ title: '当前未登录', icon: 'none' });
      return;
    }
    Taro.showModal({
      title: '退出登录',
      content: '退出后将清除头像与昵称，恢复未登录状态，确定退出吗？',
      confirmText: '退出',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return;
        try {
          Taro.removeStorageSync(PROFILE_KEY);
        } catch {
          /* 忽略 */
        }
        try {
          Taro.getFileSystemManager().unlinkSync(`${Taro.env.USER_DATA_PATH}/profile_avatar.png`);
        } catch {
          /* 无文件忽略 */
        }
        setProfile(null);
        setEditing(false);
        Taro.showToast({ title: '已退出登录', icon: 'success' });
      },
    });
  };

  const handleAbout = () => {
    Taro.showModal({
      title: '关于我们',
      content:
        `青芽影图 v${APP_VERSION}\n\n一款轻量的图片与视频小工具箱，提供证件照制作、图片处理、视频解析与压缩等实用功能。\n\n我们重视您的个人信息与肖像权，所有处理均在授权声明约定范围内进行。`,
      confirmText: '我知道了',
      showCancel: false,
      confirmColor: '#6366f1',
    });
  };

  return (
    <View className='profile'>
      {/* 头部：沉浸式——标题居中，头像 + 昵称横排，点击拉起浮层 */}
      <View className='profile__hero' onClick={openEditor}>
        <View className='profile__hero-glow profile__hero-glow--tr' />
        <View className='profile__hero-glow profile__hero-glow--bl' />
        <Text className='profile__hero-title'>我的</Text>

        <Image
          className='profile__avatar'
          src={profile?.avatar || DEFAULT_AVATAR}
          mode='aspectFill'
        />
        <View className='profile__name-wrap'>
          <Text className='profile__nickname'>
            {profile ? profile.nickname : '未登录'}
          </Text>
          <Text className='profile__name-sub'>
            {profile ? '点击修改资料' : '点击登录，保存头像与昵称'}
          </Text>
        </View>
        <Text className='profile__hero-arrow'>›</Text>
      </View>

      {/* 功能菜单 */}
      <View className='profile__card'>
        <Button
          className='profile__row profile__row--btn'
          openType='share'
          hoverClass='profile__row--hover'
        >
          <View className='profile__row-icon profile__row-icon--share'>
            <Text className='profile__row-glyph'>↗</Text>
          </View>
          <Text className='profile__row-text'>分享小程序</Text>
          <Text className='profile__row-arrow'>›</Text>
        </Button>

        <View className='profile__row' onClick={handleClearCache}>
          <View className='profile__row-icon profile__row-icon--clean'>
            <Text className='profile__row-glyph'>✦</Text>
          </View>
          <Text className='profile__row-text'>清除缓存</Text>
          <Text className='profile__row-arrow'>›</Text>
        </View>

        <View className='profile__row' onClick={handleAbout}>
          <View className='profile__row-icon profile__row-icon--about'>
            <Text className='profile__row-glyph'>i</Text>
          </View>
          <Text className='profile__row-text'>关于我们</Text>
          <Text className='profile__row-arrow'>›</Text>
        </View>

        <View
          className='profile__row profile__row--last'
          onClick={handleLogout}
        >
          <View className='profile__row-icon profile__row-icon--logout'>
            <Text className='profile__row-glyph'>⏻</Text>
          </View>
          <Text className='profile__row-text profile__row-text--danger'>退出登录</Text>
          <Text className='profile__row-arrow'>›</Text>
        </View>
      </View>

      <Text className='profile__version'>青芽影图 v{APP_VERSION}</Text>

      {/* 底部浮层：资料编辑（登录 / 修改） */}
      {editing && (
        <View className='profile__sheet-mask' catchMove onClick={() => setEditing(false)}>
          <View
            className='profile__sheet'
            catchMove
            onClick={(e) => e.stopPropagation()}
          >
            <View className='profile__sheet-grabber' />
            <Text className='profile__edit-title'>
              {profile ? '修改资料' : '登录'}
            </Text>

            <View className='profile__edit-row'>
              <Button
                className='profile__avatar-btn'
                openType='chooseAvatar'
                onChooseAvatar={handleChooseAvatar}
              >
                <Image
                  className='profile__avatar profile__avatar--edit'
                  src={draft.avatar || DEFAULT_AVATAR}
                  mode='aspectFill'
                />
                <Text className='profile__avatar-btn-tip'>选头像</Text>
              </Button>
            </View>

            <View className='profile__edit-row profile__edit-row--input'>
              <Input
                className='profile__nickname-input'
                type='nickname'
                value={draft.nickname}
                placeholder='填写昵称（可用微信昵称）'
                placeholderClass='profile__nickname-input-ph'
                onInput={handleNicknameInput}
                maxlength={16}
              />
            </View>

            <View className='profile__edit-actions'>
              <Button className='profile__btn profile__btn--ghost' onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button className='profile__btn profile__btn--primary' onClick={handleSave}>
                保存
              </Button>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

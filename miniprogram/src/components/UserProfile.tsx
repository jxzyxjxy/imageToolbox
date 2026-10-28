/**
 * 用户登录组件：首页头像入口 + 头像昵称授权弹窗 + 首启登录引导。
 * 使用微信「头像昵称填写能力」（chooseAvatar + nickname input），
 * 头像/昵称均由微信原生面板一键带出，无需手动输入。
 * 静默登录（openid 落库）在 app.tsx 启动时已做，这里负责可见的用户态。
 * 登录完全可选：游客可正常使用全部功能。
 */
import { useEffect, useState } from 'react';
import { View, Text, Image, Button, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import {
  mpLogin,
  updateProfile,
  uploadAvatar,
  secCheckText,
  getTempUrls,
  type UserProfile as Profile,
} from '@/api/cloud';
import './UserProfile.scss';

const CACHE_KEY = 'user_profile';
/** 首启引导已展示标记（展示过就不再自动弹，仍可从入口手动登录） */
const GUIDE_KEY = 'login_guide_shown';

interface CachedProfile {
  nickname: string;
  avatarUrl: string;
}

function readCache(): CachedProfile | null {
  try {
    return Taro.getStorageSync(CACHE_KEY) || null;
  } catch {
    return null;
  }
}

export default function UserProfile() {
  const [profile, setProfile] = useState<CachedProfile | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [draftAvatar, setDraftAvatar] = useState('');
  const [draftNickname, setDraftNickname] = useState('');
  const [saving, setSaving] = useState(false);
  /** 入口位置：避让右上角系统胶囊 */
  const [entryStyle, setEntryStyle] = useState<Record<string, string>>({});

  useEffect(() => {
    // 胶囊避让：入口放在胶囊正下方，右缘与胶囊对齐
    try {
      const rect = Taro.getMenuButtonBoundingClientRect();
      const win = Taro.getWindowInfo();
      if (rect && rect.bottom > 0) {
        setEntryStyle({
          top: `${rect.bottom + 10}px`,
          right: `${Math.max(0, win.windowWidth - rect.right)}px`,
        });
      }
    } catch {
      // 兜底用 scss 默认位置
    }

    // 先读本地缓存秒开，再从云端拉最新档案
    const cached = readCache();
    if (cached) setProfile(cached);
    void (async () => {
      const remote: Profile | null = await mpLogin();
      if (!remote || !remote.nickname) return;
      let avatarUrl = '';
      if (remote.avatarFileID) {
        const urls = await getTempUrls([remote.avatarFileID]);
        avatarUrl = urls.get(remote.avatarFileID) || '';
      }
      const fresh = { nickname: remote.nickname, avatarUrl };
      setProfile(fresh);
      Taro.setStorageSync(CACHE_KEY, fresh);
    })();

    // 首次进入：未登录且未展示过引导时，延迟弹出（与进场广告错开）
    try {
      const shown = Taro.getStorageSync(GUIDE_KEY);
      if (!shown && !cached?.nickname) {
        const timer = setTimeout(() => {
          // 再确认一次仍未登录（云端档案可能刚拉回来）
          if (!readCache()?.nickname) setGuideOpen(true);
        }, 1500);
        return () => clearTimeout(timer);
      }
    } catch {
      // storage 异常则不弹引导
    }
  }, []);

  const markGuideShown = () => {
    try {
      Taro.setStorageSync(GUIDE_KEY, 1);
    } catch {
      // ignore
    }
  };

  const openPanel = () => {
    setDraftAvatar(profile?.avatarUrl || '');
    setDraftNickname(profile?.nickname || '');
    setPanelOpen(true);
  };

  const onGuideLogin = () => {
    markGuideShown();
    setGuideOpen(false);
    openPanel();
  };

  const onGuideSkip = () => {
    markGuideShown();
    setGuideOpen(false);
  };

  const closePanel = () => {
    if (!saving) setPanelOpen(false);
  };

  const onChooseAvatar = (e: { detail?: { avatarUrl?: string } }) => {
    const url = e?.detail?.avatarUrl;
    if (url) setDraftAvatar(url);
  };

  const onSave = async () => {
    const nickname = draftNickname.trim();
    if (!nickname) {
      Taro.showToast({ title: '点输入框即可使用微信昵称', icon: 'none' });
      return;
    }
    if (!draftAvatar) {
      Taro.showToast({ title: '点头像即可使用微信头像', icon: 'none' });
      return;
    }
    setSaving(true);
    try {
      // UGC 内容安全检测（微信审核要求）
      const check = await secCheckText(nickname);
      if (!check.pass) {
        Taro.showToast({ title: check.error || '昵称包含违规内容', icon: 'none' });
        return;
      }
      // 已是 https 头像（未改动）则直接复用，否则上传云存储
      let avatarFileID = '';
      if (draftAvatar.startsWith('cloud://')) {
        avatarFileID = draftAvatar;
      } else {
        avatarFileID = await uploadAvatar(draftAvatar);
      }
      const saved = await updateProfile(nickname, avatarFileID);
      let avatarUrl = draftAvatar;
      if (saved.avatarFileID) {
        const urls = await getTempUrls([saved.avatarFileID]);
        avatarUrl = urls.get(saved.avatarFileID) || draftAvatar;
      }
      const fresh = { nickname: saved.nickname, avatarUrl };
      setProfile(fresh);
      Taro.setStorageSync(CACHE_KEY, fresh);
      setPanelOpen(false);
      Taro.showToast({ title: '登录成功', icon: 'success' });
    } catch (e) {
      Taro.showToast({ title: e instanceof Error ? e.message : '保存失败，请重试', icon: 'none' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="uprof">
      {/* 头像入口：药丸形态，避让系统胶囊 */}
      <View className="uprof__entry" style={entryStyle} onClick={openPanel}>
        {profile?.avatarUrl ? (
          <Image className="uprof__avatar" src={profile.avatarUrl} mode="aspectFill" />
        ) : (
          <View className="uprof__avatar uprof__avatar--empty">
            <Text className="uprof__avatar-glyph">👤</Text>
          </View>
        )}
        <Text className="uprof__name">{profile?.nickname || '登录'}</Text>
      </View>

      {/* 授权弹窗 */}
      {panelOpen && (
        <View className="uprof__mask" onClick={closePanel}>
          <View className="uprof__panel" onClick={(e) => e.stopPropagation()}>
            <View className="uprof__close" onClick={closePanel}>
              <Text className="uprof__close-icon">×</Text>
            </View>
            <Text className="uprof__panel-title">微信授权登录</Text>
            <Text className="uprof__panel-desc">一键使用微信头像昵称，无需手动填写</Text>

            <Button className="uprof__avatar-btn" openType="chooseAvatar" onChooseAvatar={onChooseAvatar}>
              {draftAvatar ? (
                <Image className="uprof__avatar-preview" src={draftAvatar} mode="aspectFill" />
              ) : (
                <View className="uprof__avatar-preview uprof__avatar-preview--empty">
                  <Text className="uprof__avatar-plus">+</Text>
                </View>
              )}
            </Button>
            <Text className="uprof__avatar-hint">点这里使用微信头像</Text>

            <Input
              className="uprof__nickname"
              type="nickname"
              placeholder="点这里使用微信昵称"
              value={draftNickname}
              onInput={(e) => setDraftNickname(e.detail.value)}
            />

            <Button className="uprof__save" disabled={saving} onClick={onSave}>
              {saving ? '登录中…' : '完成授权登录'}
            </Button>
          </View>
        </View>
      )}

      {/* 首启登录引导（仅一次，可跳过） */}
      {guideOpen && !panelOpen && (
        <View className="uprof__mask" onClick={onGuideSkip}>
          <View className="uprof__panel" onClick={(e) => e.stopPropagation()}>
            <Text className="uprof__panel-title">欢迎使用青芽影图</Text>
            <Text className="uprof__panel-desc">
              微信一键登录可同步你的使用记录；{'\n'}暂不登录也能正常使用全部功能
            </Text>
            <Button className="uprof__save uprof__save--guide" onClick={onGuideLogin}>
              微信一键登录
            </Button>
            <View className="uprof__skip" onClick={onGuideSkip}>
              <Text className="uprof__skip-text">暂不登录，直接使用</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

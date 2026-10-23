/**
 * 用户登录组件：首页右上角头像入口 + 头像昵称授权弹窗。
 * 使用微信「头像昵称填写能力」（chooseAvatar + nickname input）。
 * 静默登录（openid 落库）在 app.tsx 启动时已做，这里负责可见的用户态。
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
  const [draftAvatar, setDraftAvatar] = useState('');
  const [draftNickname, setDraftNickname] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
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
  }, []);

  const openPanel = () => {
    setDraftAvatar(profile?.avatarUrl || '');
    setDraftNickname(profile?.nickname || '');
    setPanelOpen(true);
  };

  const onChooseAvatar = (e: { detail?: { avatarUrl?: string } }) => {
    const url = e?.detail?.avatarUrl;
    if (url) setDraftAvatar(url);
  };

  const onSave = async () => {
    const nickname = draftNickname.trim();
    if (!nickname) {
      Taro.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    if (!draftAvatar) {
      Taro.showToast({ title: '请选择头像', icon: 'none' });
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
      {/* 头像入口 */}
      <View className="uprof__entry" onClick={openPanel}>
        {profile?.avatarUrl ? (
          <Image className="uprof__avatar" src={profile.avatarUrl} mode="aspectFill" />
        ) : (
          <View className="uprof__avatar uprof__avatar--empty">
            <Text className="uprof__avatar-glyph">👤</Text>
          </View>
        )}
        <Text className="uprof__name">{profile?.nickname || '点击登录'}</Text>
      </View>

      {/* 授权弹窗 */}
      {panelOpen && (
        <View className="uprof__mask" onClick={() => !saving && setPanelOpen(false)}>
          <View className="uprof__panel" onClick={(e) => e.stopPropagation()}>
            <Text className="uprof__panel-title">微信授权登录</Text>
            <Text className="uprof__panel-desc">选择头像并填写昵称，用于同步你的使用记录</Text>

            <Button className="uprof__avatar-btn" openType="chooseAvatar" onChooseAvatar={onChooseAvatar}>
              {draftAvatar ? (
                <Image className="uprof__avatar-preview" src={draftAvatar} mode="aspectFill" />
              ) : (
                <View className="uprof__avatar-preview uprof__avatar-preview--empty">
                  <Text className="uprof__avatar-plus">+</Text>
                </View>
              )}
            </Button>
            <Text className="uprof__avatar-hint">点击选择头像</Text>

            <Input
              className="uprof__nickname"
              type="nickname"
              placeholder="请输入昵称"
              value={draftNickname}
              onInput={(e) => setDraftNickname(e.detail.value)}
            />

            <Button className="uprof__save" disabled={saving} onClick={onSave}>
              {saving ? '保存中…' : '完成授权'}
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}

import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Image, Input, Text, View } from '@tarojs/components';
import { mpLogin, updateProfile, uploadAvatar, secCheckText, type UserProfile as Profile } from '../api/cloud';
import './UserProfile.scss';

const CACHE_KEY = 'yt_user_profile';

function readCache(): Profile | null {
  try {
    const raw = Taro.getStorageSync(CACHE_KEY);
    if (raw && raw.openid) return raw as Profile;
  } catch { /* ignore */ }
  return null;
}

/** 一键登录入口 + 极简授权卡片 */
export default function UserProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);          // 资料卡（已登录可编辑头像昵称）
  const [confirmOpen, setConfirmOpen] = useState(false); // 登录确认弹窗
  const [saving, setSaving] = useState(false);
  const [draftAvatar, setDraftAvatar] = useState('');
  const [draftNickname, setDraftNickname] = useState('');
  const [focusNickname, setFocusNickname] = useState(false);
  const [entryTop, setEntryTop] = useState(96);
  const [entryRight, setEntryRight] = useState(14);

  // 入口避让右上角系统胶囊：定位到胶囊正下方、右缘对齐
  useEffect(() => {
    try {
      const capsule = Taro.getMenuButtonBoundingClientRect();
      if (capsule && capsule.bottom > 0) {
        setEntryTop(Math.round(capsule.bottom + 6));
        const sys = Taro.getSystemInfoSync();
        if (sys.windowWidth && capsule.right) {
          setEntryRight(Math.max(10, Math.round(sys.windowWidth - capsule.right)));
        }
      }
    } catch { /* 定位失败用默认位置 */ }
  }, []);

  useEffect(() => {
    const cached = readCache();
    if (cached) setProfile(cached);
    mpLogin().then((p) => {
      if (p) {
        setProfile(p);
        try { Taro.setStorageSync(CACHE_KEY, p); } catch { /* ignore */ }
      }
    });
  }, []);

  const applyProfile = (p: Profile) => {
    setProfile(p);
    try { Taro.setStorageSync(CACHE_KEY, p); } catch { /* ignore */ }
  };

  const openEntry = () => {
    if (profile) {
      // 已登录：打开资料卡，可换成微信头像昵称
      setDraftAvatar(profile.avatarFileID);
      setDraftNickname(profile.nickname === '微信用户' ? '' : profile.nickname);
      setOpen(true);
    } else {
      setConfirmOpen(true);
    }
  };

  const onChooseAvatar = (e: any) => {
    const path: string = e.detail?.avatarUrl || '';
    if (path) {
      setDraftAvatar(path);
      setFocusNickname(true);
    }
  };

  /** 保存资料（昵称缺省用「微信用户」）；nicknameOverride 用于失焦自动提交 */
  /** 授权提交：未登录先静默建档，再保存头像昵称 */
  const doSubmit = async (nicknameOverride?: string) => {
    if (saving) return;
    const nickname = (nicknameOverride ?? draftNickname).trim() || '微信用户';
    const isLoginFlow = !profile;
    setSaving(true);
    try {
      const check = await secCheckText(nickname);
      if (!check.pass) {
        Taro.showToast({ title: '昵称含违规内容，请更换', icon: 'none' });
        return;
      }
      let avatarFileID = draftAvatar;
      if (avatarFileID && !avatarFileID.startsWith('cloud://')) {
        avatarFileID = await uploadAvatar(avatarFileID);
      }
      if (!profile) {
        const logged = await mpLogin();
        if (!logged) throw new Error('login failed');
        applyProfile(logged);
      }
      const updated = await updateProfile(nickname, avatarFileID || profile?.avatarFileID || '');
      applyProfile(updated);
      setConfirmOpen(false);
      setOpen(false);
      Taro.showToast({ title: isLoginFlow ? '登录成功' : '已保存', icon: 'success' });
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '登录失败，请重试', icon: 'none' });
    } finally {
      setSaving(false);
    }
  };

  const onNicknameBlur = async (e: any) => {
    setFocusNickname(false);
    const v: string = e?.detail?.value?.trim?.() || '';
    if (v) setDraftNickname(v);
    if (v && draftAvatar && !saving) await doSubmit(v);
  };

  const nicknameDisplay = profile?.nickname || '微信用户';

  return (
    <>
      <View className="up-entry" style={{ top: `${entryTop}px`, right: `${entryRight}px` }} onClick={openEntry}>
        {profile && profile.avatarFileID ? (
          <Image className="up-entry__avatar" src={profile.avatarFileID} mode="aspectFill" />
        ) : (
          <View className="up-entry__fallback"><Text className="up-entry__glyph">👤</Text></View>
        )}
      </View>

      {/* 微信授权卡：允许=微信头像昵称一键，也可暂不登录（游客可用） */}
      {confirmOpen && (
        <View className="up-mask" onClick={() => !saving && setConfirmOpen(false)}>
          <View className="up-card" onClick={(e) => e.stopPropagation()}>
            <View className="up-card__close" onClick={() => !saving && setConfirmOpen(false)}>
              <Text className="up-card__close-icon">✕</Text>
            </View>
            <Button className="up-card__avatar-btn" openType="chooseAvatar" onChooseAvatar={onChooseAvatar}>
              {draftAvatar ? (
                <Image className="up-card__avatar-img" src={draftAvatar} mode="aspectFill" />
              ) : (
                <View className="up-card__avatar-placeholder">
                  <Text className="up-card__avatar-plus">+</Text>
                </View>
              )}
            </Button>
            <Text className="up-card__title">微信授权登录</Text>
            <Text className="up-card__desc">申请获取你的公开信息（头像、昵称）用于展示个人资料。不想提供可直接使用全部功能。</Text>
            <Input
              className="up-card__nick"
              type="nickname"
              placeholder="点此使用微信昵称"
              value={draftNickname}
              focus={focusNickname}
              disabled={saving}
              onInput={(e) => setDraftNickname(e.detail.value)}
              onBlur={onNicknameBlur}
            />
            <Button className="up-card__save" loading={saving} disabled={saving} onClick={() => doSubmit()}>
              {saving ? '授权中…' : '允许并登录'}
            </Button>
            <View className="up-card__skip" onClick={() => !saving && setConfirmOpen(false)}>
              <Text className="up-card__skip-text">暂不登录，直接使用</Text>
            </View>
          </View>
        </View>
      )}

      {/* 我的资料：已登录后可换成微信头像昵称（官方 chooseAvatar + nickname） */}
      {open && (
        <View className="up-mask" onClick={() => !saving && setOpen(false)}>
          <View className="up-card" onClick={(e) => e.stopPropagation()}>
            <View className="up-card__close" onClick={() => !saving && setOpen(false)}>
              <Text className="up-card__close-icon">✕</Text>
            </View>
            <Text className="up-card__title">我的资料</Text>
            <Text className="up-card__desc">点下方即可换成你的微信头像、昵称</Text>
            <Button className="up-card__avatar-btn" openType="chooseAvatar" onChooseAvatar={onChooseAvatar}>
              {draftAvatar ? (
                <Image className="up-card__avatar-img" src={draftAvatar} mode="aspectFill" />
              ) : (
                <View className="up-card__avatar-placeholder">
                  <Text className="up-card__avatar-plus">+</Text>
                </View>
              )}
            </Button>
            <Text className="up-card__avatar-tip">点这里使用微信头像</Text>
            <Input
              className="up-card__nick"
              type="nickname"
              placeholder="点这里使用微信昵称"
              value={draftNickname}
              focus={focusNickname}
              disabled={saving}
              onInput={(e) => setDraftNickname(e.detail.value)}
              onBlur={onNicknameBlur}
            />
            <Button className="up-card__save" loading={saving} disabled={saving} onClick={() => doSubmit()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </View>
        </View>
      )}
    </>
  );
}

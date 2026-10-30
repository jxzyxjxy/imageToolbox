import { useState } from 'react';
import { View, Text, Image, Textarea } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { parseVideoLink, ParseVideoResponse } from '@/api/client';
import { downloadTemp } from '@/api/cloud';
import { requestVideoConsent, hasVideoConsent } from '@/utils/consent';
import ConsentCheckbox from '@/components/ConsentCheckbox';
import { formatSize } from '@/utils/image';
import './index.scss';

/**
 * 链接取回原片：粘贴抖音分享链接 → 云函数解析无水印源并转存云存储 → 保存相册。
 * 首次进入弹「用户声明及版权提示」（同肖像授权勾选条模式）。
 */
export default function VideoParse() {
  const [authed, setAuthed] = useState(() => hasVideoConsent());
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseVideoResponse | null>(null);
  const [saving, setSaving] = useState(false);

  useDidShow(() => {
    requestVideoConsent(
      () => setAuthed(true),
      () => console.log('[video-parse] 用户拒绝声明，按钮保持置灰'),
    );
  });

  const pasteFromClipboard = async () => {
    try {
      const res = await Taro.getClipboardData();
      if (res.data) {
        setText(res.data.trim().slice(0, 2000));
        setResult(null);
      }
    } catch {
      Taro.showToast({ title: '读取剪贴板失败', icon: 'none' });
    }
  };

  const parse = async () => {
    if (!authed) {
      Taro.showToast({ title: '请先勾选上方用户声明', icon: 'none' });
      return;
    }
    if (parsing) return;
    if (!text.trim()) {
      Taro.showToast({ title: '请先粘贴分享链接', icon: 'none' });
      return;
    }
    setParsing(true);
    setResult(null);
    try {
      const res = await parseVideoLink(text);
      if (!res.ok || !res.videoFileID) {
        Taro.showToast({ title: res.error || '解析失败，请检查链接', icon: 'none' });
        return;
      }
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解析失败，请稍后重试';
      Taro.showToast({ title: msg, icon: 'none' });
    } finally {
      setParsing(false);
    }
  };

  const saveToAlbum = async () => {
    if (!result?.videoFileID || saving) return;
    setSaving(true);
    Taro.showLoading({ title: '视频下载中…', mask: true });
    try {
      const temp = await downloadTemp(result.videoFileID);
      Taro.hideLoading();
      try {
        await Taro.saveVideoToPhotosAlbum({ filePath: temp });
        Taro.showToast({ title: '已保存到相册', icon: 'success' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('auth') || msg.includes('deny')) {
          Taro.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存视频到相册',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) Taro.openSetting();
            },
          });
        } else {
          Taro.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    } catch (err) {
      Taro.hideLoading();
      const msg = err instanceof Error ? err.message : '视频下载失败';
      Taro.showToast({ title: msg, icon: 'none' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="page">
      {/* 标题横幅 */}
      <View className="banner">
        <Text className="banner__title">链接取回原片</Text>
        <Text className="banner__desc">粘贴分享链接，取回无水印的原创视频</Text>
      </View>

      {/* 链接输入 */}
      <View className="card">
        <View className="card__label-row">
          <Text className="card__label">粘贴分享内容</Text>
          <Text className="card__paste" onClick={pasteFromClipboard}>
            粘贴
          </Text>
        </View>
        <Textarea
          className="input"
          value={text}
          placeholder="粘贴视频分享链接或整段分享文案"
          maxlength={2000}
          autoHeight
          onInput={(e) => setText(e.detail.value)}
        />
        <Text className="card__tip">当前支持抖音分享链接，更多平台即将上线</Text>
      </View>

      {/* 结果 */}
      {result && (
        <View className="card">
          <Text className="card__label">解析结果</Text>
          <View className="result">
            {result.coverFileID ? (
              <Image className="result__cover" src={result.coverFileID} mode="aspectFill" />
            ) : (
              <View className="result__cover result__cover--empty">
                <Text className="result__cover-icon">🎬</Text>
              </View>
            )}
            <View className="result__meta">
              <Text className="result__title">{result.title || '无水印视频'}</Text>
              {result.size ? (
                <Text className="result__size">{formatSize(result.size)}</Text>
              ) : null}
              {result.note ? <Text className="result__note">{result.note}</Text> : null}
            </View>
          </View>
          <View
            className={`btn ${saving ? 'btn--disabled' : ''}`}
            onClick={saveToAlbum}
          >
            <Text className="btn__text">{saving ? '处理中…' : '保存到相册'}</Text>
          </View>
        </View>
      )}

      {/* 底部操作栏 */}
      <View className="footer">
        <ConsentCheckbox authed={authed} onGrant={() => setAuthed(true)} type="video" />
        <View
          className={`footer__btn ${!authed || parsing ? 'footer__btn--disabled' : ''}`}
          onClick={parse}
        >
          <Text className="footer__btn-text">{parsing ? '解析中…' : '立即解析'}</Text>
        </View>
        <Text className="footer__legal">仅供备份本人发布或已获授权的原创内容</Text>
      </View>
    </View>
  );
}

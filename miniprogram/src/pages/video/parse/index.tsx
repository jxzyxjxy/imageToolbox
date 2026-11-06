import { useState } from 'react';
import { View, Text, Textarea } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { parseVideoLink } from '@/api/client';
import { hasVideoConsent, requestVideoConsent } from '@/utils/consent';
import { parseResultCache } from '@/utils/parseResultCache';
import './index.scss';

/**
 * 链接取回原片（输入页）：粘贴分享链接 → 解析 → 跳转结果页预览/下载。
 * 按钮紧随输入框（下方整块预留广告位）；首次点「立即解析」弹声明确认，
 * 同意后记住（后续无感）。结果展示与保存全部移至 result 页。
 */
export default function VideoParse() {
  const [authed, setAuthed] = useState(() => hasVideoConsent());
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);

  const pasteFromClipboard = async () => {
    try {
      const res = await Taro.getClipboardData();
      if (res.data) setText(res.data.trim().slice(0, 2000));
    } catch {
      Taro.showToast({ title: '读取剪贴板失败', icon: 'none' });
    }
  };

  const doParse = async () => {
    if (parsing) return;
    if (!text.trim()) {
      Taro.showToast({ title: '请先粘贴分享链接', icon: 'none' });
      return;
    }
    setParsing(true);
    try {
      const res = await parseVideoLink(text);
      if (!res.ok || (!res.videoFileID && !res.clientDownload)) {
        const verTag = res.ver ? `（${res.ver}）` : '（旧版云函数，请重新部署）';
        Taro.showToast({ title: (res.error || '解析失败，请检查链接') + verTag, icon: 'none' });
        return;
      }
      parseResultCache.data = { result: res, text };
      Taro.navigateTo({ url: '/pages/video/result/index' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解析失败，请稍后重试';
      Taro.showToast({ title: msg, icon: 'none' });
    } finally {
      setParsing(false);
    }
  };

  const parse = () => {
    // 首次使用：弹「用户声明及版权免责声明」，同意后记住并继续解析
    if (!authed) {
      requestVideoConsent(
        () => {
          setAuthed(true);
          void doParse();
        },
        () => console.log('[video-parse] 用户拒绝声明，未开始解析'),
      );
      return;
    }
    void doParse();
  };

  const openConsent = () => {
    requestVideoConsent(
      () => setAuthed(true),
      () => console.log('[video-parse] 用户关闭声明弹窗'),
    );
  };

  return (
    <View className="page">
      {/* 标题横幅 */}
      <View className="banner">
        <Text className="banner__title">链接取回原片</Text>
        <Text className="banner__desc">粘贴分享链接，取回无水印的原创视频</Text>
      </View>

      {/* 链接输入 + 操作按钮 */}
      <View className="card">
        <Textarea
          className="input"
          value={text}
          placeholder="粘贴视频分享链接或整段分享文案"
          maxlength={2000}
          autoHeight
          onInput={(e) => setText(e.detail.value)}
        />
        <View className="actions">
          <View className="actions__paste" onClick={pasteFromClipboard}>
            <Text className="actions__paste-text">粘贴链接</Text>
          </View>
          <View
            className={`actions__parse ${parsing || !text.trim() ? 'is-disabled' : ''}`}
            onClick={parse}
          >
            <Text className="actions__parse-text">{parsing ? '解析中…' : '立即解析'}</Text>
          </View>
        </View>
        <View className="legal" onClick={openConsent}>
          <Text className="legal__text">使用即代表同意</Text>
          <Text className="legal__link">《用户声明及版权免责声明》</Text>
        </View>
      </View>

      {/* 广告位预留（接入时替换为 ad 组件） */}
      <View className="ad-slot">
        <Text className="ad-slot__text">广告位</Text>
      </View>
    </View>
  );
}

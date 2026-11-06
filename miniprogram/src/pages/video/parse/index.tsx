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
      if (!res.ok || (!res.videoFileID && !res.clientDownload)) {
        const verTag = res.ver ? `（${res.ver}）` : '（旧版云函数，请重新部署）';
        Taro.showToast({ title: (res.error || '解析失败，请检查链接') + verTag, icon: 'none' });
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
    if (!result || saving) return;
    if (!result.videoFileID && !(result.clientDownload && result.play)) return;
    setSaving(true);
    Taro.showLoading({ title: '视频下载中…', mask: true });
    try {
      let temp = '';
      if (result.clientDownload && result.play) {
        // 抖音/豆包等：前端直下播放直链（用户网络可通，自动跟随 302 到 CDN）。
        // 豆包等平台优先尝试 playNoMark（无水印通道：字节通用播放接口），
        // 失败（HTTP 非 200）自动降级 play（官方流）。
        const candidates = [
          result.playNoMark,
          result.play,
          ...(Array.isArray(result.playFallbacks) ? result.playFallbacks : []),
        ]
          .filter((x): x is string => typeof x === 'string' && x.length > 0)
          .filter((x, i, arr) => arr.indexOf(x) === i); // 去重：聚合通道 play/playNoMark 同链
        let lastErr: unknown = new Error('视频下载失败，请稍后重试');
        let downloaded = false;
        let domainBlocked = false;
        for (const cand of candidates) {
          try {
            const dl = await Taro.downloadFile({ url: cand });
            if (dl.statusCode !== 200) {
              lastErr = new Error(`视频下载失败（HTTP ${dl.statusCode}）`);
              continue; // 尝试下一候选
            }
            temp = dl.tempFilePath;
            downloaded = true;
            break;
          } catch (err: unknown) {
            // downloadFile 域名白名单拦截：CDN 版本前缀变体多（豆包/抖音等），无法穷举预配，
            // 不再提示补配域名——记录后继续试其他候选，全部失败自动切云函数转存兜底
            const errMsg = err && typeof err === 'object' && 'errMsg' in err ? String((err as { errMsg: string }).errMsg) : err instanceof Error ? err.message : '';
            if (errMsg.includes('url not in domain list')) {
              domainBlocked = true;
              continue;
            }
            lastErr = err instanceof Error ? err : new Error('视频下载失败，请稍后重试');
          }
        }
        if (!downloaded && domainBlocked && text) {
          // 直链域名被白名单拦截：自动二次请求云函数转存（云函数下载+上传，约 10~15s）
          Taro.showLoading({ title: '转存中，请稍候…', mask: true });
          const relay = await parseVideoLink(text, { forceRelay: true });
          if (relay.ok && relay.videoFileID) {
            temp = await downloadTemp(relay.videoFileID);
            downloaded = true;
          } else {
            throw new Error(relay.error || '视频转存失败，请稍后重试');
          }
        }
        if (!downloaded) throw lastErr;
      } else {
        temp = await downloadTemp(result.videoFileID as string);
      }
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
        } else if (msg.includes('privacy')) {
          // 《用户隐私保护指引》未声明相册权限或声明审核中——后台配置生效后自动恢复
          console.error('[save] privacy not declared:', msg);
          Taro.showToast({ title: '功能配置更新中，请稍后再试', icon: 'none', duration: 2500 });
        } else {
          console.error('[save] 保存失败:', msg);
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
              {result.ver ? (
                <Text className="result__note">解析引擎 {result.ver}</Text>
              ) : (
                <Text className="result__note">解析引擎过旧，请重新部署云函数</Text>
              )}
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

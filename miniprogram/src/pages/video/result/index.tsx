import { useState } from 'react';
import { View, Text, Image, Video } from '@tarojs/components';
import Taro, { useLoad } from '@tarojs/taro';
import { parseVideoLink, ParseVideoResponse } from '@/api/client';
import { downloadTemp, getTempUrls } from '@/api/cloud';
import { parseResultCache } from '@/utils/parseResultCache';
import './index.scss';

type ResultTab = 'video' | 'cover' | 'title';

interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

/**
 * 解析结果页（二级页，无 tabBar）：
 * 视频 / 封面 / 标题 三个 Tab——视频可在线预览（时长/分辨率），
 * 下载走原解析页同款候选降级链（直链直下 → 域名拦截自动云函数转存）。
 * 数据来自 parseResultCache（解析页写入），读不到提示返回重新解析。
 */
export default function ParseResult() {
  const [result, setResult] = useState<ParseVideoResponse | null>(null);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<ResultTab>('video');
  const [videoSrc, setVideoSrc] = useState('');
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [videoErr, setVideoErr] = useState(false);
  const [saving, setSaving] = useState(false);

  useLoad(async () => {
    const data = parseResultCache.data;
    if (!data) return;
    setResult(data.result);
    setText(data.text);
    const r = data.result;
    if (r.clientDownload && (r.playNoMark || r.play)) {
      setVideoSrc((r.playNoMark || r.play) as string);
    } else if (r.videoFileID) {
      // 转存模式：fileID 换临时 https 链接供预览
      try {
        const map = await getTempUrls([r.videoFileID]);
        const url = map.get(r.videoFileID);
        if (url) setVideoSrc(url);
      } catch {
        // 预览链接获取失败不阻断：下载仍走 downloadTemp
      }
    }
  });

  const formatDuration = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '未知';
    const s = Math.round(sec);
    if (s < 60) return `${s}秒`;
    return `${Math.floor(s / 60)}分${s % 60}秒`;
  };

  const copyLink = async () => {
    if (!videoSrc) {
      Taro.showToast({ title: '暂无可复制的链接', icon: 'none' });
      return;
    }
    try {
      await Taro.setClipboardData({ data: videoSrc });
    } catch {
      Taro.showToast({ title: '复制失败', icon: 'none' });
    }
  };

  const copyTitle = async () => {
    const t = (result && result.title) || '';
    if (!t) {
      Taro.showToast({ title: '该分享未提供标题', icon: 'none' });
      return;
    }
    try {
      await Taro.setClipboardData({ data: t });
    } catch {
      Taro.showToast({ title: '复制失败', icon: 'none' });
    }
  };

  const saveCover = async () => {
    if (!result || !result.coverFileID || saving) return;
    setSaving(true);
    Taro.showLoading({ title: '封面下载中…', mask: true });
    try {
      const temp = await downloadTemp(result.coverFileID);
      Taro.hideLoading();
      await Taro.saveImageToPhotosAlbum({ filePath: temp });
      Taro.showToast({ title: '封面已保存', icon: 'success' });
    } catch (err) {
      Taro.hideLoading();
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('auth') || msg.includes('deny')) {
        Taro.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存图片到相册',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) Taro.openSetting();
          },
        });
      } else {
        Taro.showToast({ title: msg || '封面保存失败', icon: 'none' });
      }
    } finally {
      setSaving(false);
    }
  };

  const downloadVideo = async () => {
    if (!result || saving) return;
    if (!result.videoFileID && !(result.clientDownload && result.play)) return;
    setSaving(true);
    Taro.showLoading({ title: '视频下载中…', mask: true });
    try {
      let temp = '';
      if (result.clientDownload && result.play) {
        // 前端直下播放直链（用户网络可通，自动跟随 302 到 CDN），
        // 优先无水印通道，失败（HTTP 非 200 / 防盗链）自动降级候选。
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
            // downloadFile 域名白名单拦截：CDN 版本前缀变体多，无法穷举预配，
            // 不提示补配域名——记录后继续试其他候选，全部失败自动切云函数转存兜底
            const errMsg =
              err && typeof err === 'object' && 'errMsg' in err
                ? String((err as { errMsg: string }).errMsg)
                : err instanceof Error
                  ? err.message
                  : '';
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

  const goBack = () => Taro.navigateBack({ fail: () => Taro.reLaunch({ url: '/pages/index/index' }) });

  /* 数据缺失（直接打开/缓存丢失）：空态引导返回 */
  if (!result) {
    return (
      <View className="page">
        <View className="card empty">
          <Text className="empty__icon">🎬</Text>
          <Text className="empty__text">解析数据已失效，请返回重新解析</Text>
          <View className="btn-main" onClick={goBack}>
            <Text className="btn-main__text">返回重新解析</Text>
          </View>
        </View>
      </View>
    );
  }

  const tabs: Array<{ key: ResultTab; label: string }> = [
    { key: 'video', label: '视频' },
    { key: 'cover', label: '封面' },
    { key: 'title', label: '标题' },
  ];

  return (
    <View className="page">
      {/* 内容 Tab */}
      <View className="tabs">
        {tabs.map((t) => (
          <View
            key={t.key}
            className={`tabs__item ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <Text className={`tabs__text ${tab === t.key ? 'is-active' : ''}`}>{t.label}</Text>
          </View>
        ))}
      </View>

      {tab === 'video' && (
        <View className="card">
          {videoSrc && !videoErr ? (
            <Video
              className="player"
              src={videoSrc}
              poster={
                result.coverFileID && result.coverFileID.startsWith('https')
                  ? result.coverFileID
                  : ''
              }
              controls
              objectFit="contain"
              onLoadedMetaData={(e) => {
                const d = e.detail || {};
                setVideoMeta({ width: Number(d.width) || 0, height: Number(d.height) || 0, duration: Number(d.duration) || 0 });
              }}
              onError={() => setVideoErr(true)}
            />
          ) : (
            <View className="player player--fallback">
              {result.coverFileID ? (
                <Image className="player__poster" src={result.coverFileID} mode="aspectFill" />
              ) : null}
              <Text className="player__err">在线预览不可用，可直接下载视频</Text>
            </View>
          )}

          <View className="meta">
            <Text className="meta__item">
              时长：
              {videoMeta ? formatDuration(videoMeta.duration) : result.size ? '下载后查看' : '未知'}
            </Text>
            <Text className="meta__item">
              分辨率：
              {videoMeta && videoMeta.width ? `${videoMeta.width}x${videoMeta.height}` : '下载后查看'}
            </Text>
            {result.size ? (
              <Text className="meta__item">大小：{result.size >= 1048576 ? `${(result.size / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(result.size / 1024))}KB`}</Text>
            ) : null}
          </View>

          <View className="btn-row">
            <View className="btn-row__sub" onClick={copyLink}>
              <Text className="btn-row__sub-text">复制链接</Text>
            </View>
            <View className={`btn-row__main ${saving ? 'is-disabled' : ''}`} onClick={downloadVideo}>
              <Text className="btn-row__main-text">{saving ? '处理中…' : '下载视频'}</Text>
            </View>
          </View>
        </View>
      )}

      {tab === 'cover' && (
        <View className="card">
          {result.coverFileID ? (
            <Image
              className="cover"
              src={result.coverFileID}
              mode="widthFix"
              onClick={() => {
                // previewImage 仅支持网络路径：云存储 fileID 先换临时 https 链接再预览
                const src = result.coverFileID as string;
                if (src.startsWith('https')) {
                  Taro.previewImage({ urls: [src] });
                } else {
                  getTempUrls([src])
                    .then((map) => {
                      const url = map.get(src);
                      if (url) Taro.previewImage({ urls: [url] });
                    })
                    .catch(() => Taro.showToast({ title: '预览失败', icon: 'none' }));
                }
              }}
            />
          ) : (
            <View className="cover cover--empty">
              <Text className="cover__empty-text">该分享未提供封面</Text>
            </View>
          )}
          {result.coverFileID ? (
            <View className={`btn-main ${saving ? 'is-disabled' : ''}`} onClick={saveCover}>
              <Text className="btn-main__text">保存封面</Text>
            </View>
          ) : null}
        </View>
      )}

      {tab === 'title' && (
        <View className="card">
          <Text className="title-text">{result.title || '（该分享未提供标题）'}</Text>
          {result.note ? <Text className="title-note">{result.note}</Text> : null}
          {result.ver ? (
            <Text className="title-note">解析引擎 {result.ver}</Text>
          ) : (
            <Text className="title-note">解析引擎过旧，请重新部署云函数</Text>
          )}
          <View className="btn-main" onClick={copyTitle}>
            <Text className="btn-main__text">复制标题</Text>
          </View>
        </View>
      )}

      {/* 广告位预留（接入时替换为 ad 组件） */}
      <View className="ad-slot">
        <Text className="ad-slot__text">广告位</Text>
      </View>
    </View>
  );
}

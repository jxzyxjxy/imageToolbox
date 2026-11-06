import { useState } from 'react';
import { View, Text, Image, Video } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { formatSize } from '@/utils/image';
import './index.scss';

/** 选中的视频（chooseMedia 返回，均为本地临时文件） */
interface ChosenVideo {
  path: string;
  thumb: string;
  size: number;
  /** 秒 */
  duration: number;
}

interface CompressResult {
  path: string;
  size: number;
}

/**
 * 压缩档位：bitrate 全平台生效（Android 主导）；quality 仅 iOS；resolution/fps 仅 iOS。
 * 小巧档额外降分辨率（0.75x）强制拉开产物差异——iOS 上 bitrate 可能无效，
 * 分辨率缩放是 iOS 唯一可靠的体积差异化手段。
 */
const LEVELS = [
  { key: 'high', name: '高清', desc: '画质优先，适度减小体积', ratio: 0.75, min: 500, max: 6000, resolution: 1, fps: 30 },
  { key: 'medium', name: '均衡', desc: '画质与体积兼顾', ratio: 0.5, min: 400, max: 4000, resolution: 1, fps: 30 },
  { key: 'low', name: '小巧', desc: '体积优先，便于分享传输', ratio: 0.3, min: 250, max: 2500, resolution: 0.75, fps: 24 },
] as const;

type LevelKey = (typeof LEVELS)[number]['key'];

/** 估算原视频码率（kbps），作为三档压缩的基准 */
function estimateBitrate(v: ChosenVideo): number {
  if (v.duration <= 0 || v.size <= 0) return 1500;
  return Math.round((v.size * 8) / v.duration / 1000);
}

/**
 * 实测文件真实大小（字节）。
 * compressVideo 返回的 res.size / getFileInfo / fsm.stat 在部分机型对压缩产物均可能返回假值，
 * 首选 getVideoInfo（直接解析 MP4 元数据，与文件系统无关，最可靠）。
 */
async function realFileSize(path: string, fallback: number): Promise<number> {
  // 途径一：getVideoInfo 读视频元数据里的 size
  try {
    const info = (await Taro.getVideoInfo({ src: path })) as { size?: number };
    if (info && info.size && info.size > 0) return info.size;
  } catch {
    /* 继续尝试 */
  }
  // 途径二：FileSystemManager.stat
  try {
    const fsm = Taro.getFileSystemManager();
    const stats = await new Promise<{ size: number }>((resolve, reject) => {
      fsm.stat({
        path,
        success: (r) => {
          const s = (r as { stats?: { size?: number } }).stats;
          if (s && s.size && s.size > 0) resolve({ size: s.size });
          else reject(new Error('bad stats'));
        },
        fail: reject,
      });
    });
    return stats.size;
  } catch {
    /* 继续尝试 */
  }
  // 途径三：getFileInfo（部分 iOS 版本已知返回假值，仅兜底）
  try {
    const info = (await Taro.getFileInfo({ filePath: path })) as { size?: number };
    if (info && info.size && info.size > 0) return info.size;
  } catch {
    /* 都失败用兜底值 */
  }
  return fallback;
}

export default function VideoCompress() {
  const [video, setVideo] = useState<ChosenVideo | null>(null);
  const [level, setLevel] = useState<LevelKey>('medium');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompressResult | null>(null);

  const pickVideo = async () => {
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['video'],
        sourceType: ['album', 'camera'],
        maxDuration: 60,
      });
      const f = res.tempFiles[0];
      if (!f) return;
      // chooseMedia 的 size 也可能返回假值，选完立即实测，码率估算与展示都基于真实值
      const realSize = await realFileSize(f.tempFilePath, f.size || 0);
      setVideo({
        path: f.tempFilePath,
        thumb: f.thumbTempFilePath || '',
        size: realSize,
        duration: f.duration || 0,
      });
      setResult(null);
    } catch {
      /* 用户取消选图，静默 */
    }
  };

  const compress = async () => {
    if (!video) {
      Taro.showToast({ title: '请先选择视频', icon: 'none' });
      return;
    }
    if (busy) return;
    setBusy(true);
    const lv = LEVELS.find((l) => l.key === level);
    try {
      const orig = estimateBitrate(video);
      const bitrate = Math.round(
        Math.min(Math.max(orig * (lv ? lv.ratio : 0.5), lv ? lv.min : 400), lv ? lv.max : 4000),
      );
      const res = await Taro.compressVideo({
        src: video.path,
        bitrate,
        // Taro 类型要求三参齐传（微信端 bitrate 主导，quality 仅 iOS 生效）
        quality: lv ? lv.key : 'medium',
        fps: lv ? lv.fps : 30,
        resolution: lv ? lv.resolution : 1,
      });
      const outSize = await realFileSize(res.tempFilePath, res.size || 0);
      const origSize = await realFileSize(video.path, video.size);
      // 收益不足 5% 视为平台未实际压缩，直接提供原片（诚实展示优于假压缩率）
      if (outSize > 0 && outSize < origSize * 0.95) {
        setResult({ path: res.tempFilePath, size: outSize });
        setVideo((v) => (v ? { ...v, size: origSize } : v));
        Taro.showToast({ title: '压缩完成', icon: 'success' });
      } else {
        // 原视频已充分压缩：压缩产物不小于原片，直接提供原片保存
        setResult({ path: video.path, size: origSize });
        setVideo((v) => (v ? { ...v, size: origSize } : v));
        Taro.showToast({ title: '原视频已足够小，无需再压', icon: 'none' });
      }
    } catch (err) {
      console.error('[video-compress] 压缩失败', err);
      Taro.showToast({ title: '压缩失败，请重试', icon: 'none' });
    } finally {
      setBusy(false);
    }
  };

  const saveToAlbum = async () => {
    if (!result) return;
    try {
      await Taro.saveVideoToPhotosAlbum({ filePath: result.path });
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
  };

  const saved = (): string => {
    if (!video || !result) return '';
    const pct = Math.round((1 - result.size / video.size) * 100);
    return pct > 0 ? `体积减小 ${pct}%` : '';
  };

  return (
    <View className="page">
      {/* 标题横幅 */}
      <View className="banner">
        <Text className="banner__title">视频压缩</Text>
        <Text className="banner__desc">本地压缩不联网，速度由设备性能决定</Text>
      </View>

      {/* 视频选择 / 预览 */}
      <View className="card">
        <Text className="card__label">选择视频</Text>
        {video ? (
          <View className="preview" onClick={pickVideo}>
            {video.thumb ? (
              <Image className="preview__thumb" src={video.thumb} mode="aspectFill" />
            ) : (
              <Video
                className="preview__thumb"
                src={video.path}
                controls={false}
                autoplay={false}
              />
            )}
            <View className="preview__info">
              <Text className="preview__size">{formatSize(video.size)}</Text>
              <Text className="preview__duration">
                {video.duration > 0 ? `${Math.round(video.duration)} 秒` : ''}
              </Text>
            </View>
            <Text className="preview__rechoose">点击重选</Text>
          </View>
        ) : (
          <View className="picker" onClick={pickVideo}>
            <Text className="picker__icon">🎬</Text>
            <Text className="picker__text">点击选择视频（≤200MB）</Text>
          </View>
        )}
      </View>

      {/* 档位选择 */}
      {video && (
        <View className="card">
          <Text className="card__label">压缩强度</Text>
          <View className="levels">
            {LEVELS.map((l) => (
              <View
                key={l.key}
                className={`level ${level === l.key ? 'level--active' : ''}`}
                onClick={() => setLevel(l.key)}
              >
                <Text className="level__name">{l.name}</Text>
                <Text className="level__desc">{l.desc}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 结果 */}
      {result && (
        <View className="card">
          <Text className="card__label">压缩结果{saved() ? ` · ${saved()}` : ''}</Text>
          <View className="result">
            <View className="result__row">
              <Text className="result__k">原视频</Text>
              <Text className="result__v">{video ? formatSize(video.size) : '-'}</Text>
            </View>
            <View className="result__row">
              <Text className="result__k">压缩后</Text>
              <Text className="result__v result__v--hl">{formatSize(result.size)}</Text>
            </View>
          </View>
          <View className="card__actions">
            <View className="btn btn--ghost" onClick={compress}>
              <Text className="btn__text btn__text--ghost">重新压缩</Text>
            </View>
            <View className="btn btn--primary" onClick={saveToAlbum}>
              <Text className="btn__text">保存到相册</Text>
            </View>
          </View>
        </View>
      )}

      {/* 底部操作栏 */}
      <View className="footer">
        {video ? (
          <View
            className={`footer__btn ${busy ? 'footer__btn--disabled' : ''}`}
            onClick={compress}
          >
            <Text className="footer__btn-text">{busy ? '压缩中…' : '开始压缩'}</Text>
          </View>
        ) : (
          <View className="footer__btn" onClick={pickVideo}>
            <Text className="footer__btn-text">选择视频</Text>
          </View>
        )}
      </View>
    </View>
  );
}

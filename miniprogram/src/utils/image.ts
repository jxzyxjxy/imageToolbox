import Taro from '@tarojs/taro';
import { secCheckImage } from '@/api/cloud';

export interface ChosenImage {
  filePath: string;
  width: number;
  height: number;
  /** 字节数 */
  size: number;
  /** 原图 MIME（透明 PNG 必须保留，不能被转成 JPEG 黑底） */
  mime: string;
}

export interface ChooseImageOptions {
  /** 是否先做内容安全检测（图片会上传云端的工具必须开启） */
  secCheck?: boolean;
}

/** 压缩出一张小图用于内容安全送检 */
async function makeSecCheckBase64(filePath: string): Promise<string | null> {
  try {
    const compressed = await Taro.compressImage({
      src: filePath,
      quality: 20,
      compressedWidth: 480,
    });
    const fs = Taro.getFileSystemManager();
    return fs.readFileSync(compressed.tempFilePath, 'base64') as string;
  } catch (e) {
    console.warn('[secCheck] 压缩送检图失败，跳过检测:', e);
    return null;
  }
}

/** 选择一张图片，返回本地路径、尺寸与文件大小；可选内容安全检测（违规返回 null） */
export async function chooseImage(
  options: ChooseImageOptions = {},
): Promise<ChosenImage | null> {
  console.log('[img] chooseImage 开始', options.secCheck ? '(含安全检测)' : '');
  const res = await Taro.chooseImage({
    count: 1,
    sizeType: ['original', 'compressed'],
    sourceType: ['album', 'camera'],
  });
  const filePath = res.tempFilePaths?.[0];
  console.log('[img] 选图返回:', filePath || '(未选)');
  if (!filePath) return null;

  const ext = (filePath.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase();
  // 云端图像解码基于 jimp，不支持 WebP；直接拦截避免白跑一趟
  if (ext === 'webp') {
    await Taro.showToast({
      title: '暂不支持 WebP 图片，请转存为 JPG/PNG',
      icon: 'none',
      duration: 2500,
    });
    return null;
  }

  if (options.secCheck) {
    const small = await makeSecCheckBase64(filePath);
    console.log('[img] 送检小图生成:', small ? `${Math.round(small.length / 1024)}KB` : '跳过(压缩失败或不可用)');
    if (small) {
      const check = await secCheckImage(small);
      console.log('[img] 安全检测结果:', JSON.stringify(check));
      if (!check.pass) {
        await Taro.showToast({
          title: check.error || '图片包含违规内容',
          icon: 'none',
          duration: 2500,
        });
        return null;
      }
    }
  }

  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : 'image/png';
  const info = await Taro.getImageInfo({ src: filePath });
  console.log('[img] 图片信息:', `${info.width}x${info.height}`, 'chooseImage 完成');
  return {
    filePath,
    width: info.width,
    height: info.height,
    size: res.tempFiles?.[0]?.size ?? 0,
    mime,
  };
}

/** 保存本地图片文件到相册（含权限提示） */
export async function saveToAlbum(filePath: string): Promise<void> {
  try {
    await Taro.saveImageToPhotosAlbum({ filePath });
    await Taro.showToast({ title: '已保存到相册', icon: 'success' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('auth') || msg.includes('deny')) {
      await Taro.showModal({
        title: '需要相册权限',
        content: '请在设置中允许保存图片到相册',
        confirmText: '去设置',
        success: (r) => {
          if (r.confirm) Taro.openSetting();
        },
      });
    } else {
      await Taro.showToast({ title: '保存失败', icon: 'none' });
    }
  }
}

/** 格式化字节数 */
export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

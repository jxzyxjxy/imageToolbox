import Taro from '@tarojs/taro';
import { secCheckImage } from '@/api/cloud';

export interface ChosenImage {
  dataUrl: string;
  filePath: string;
  width: number;
  height: number;
  /** 字节数 */
  size: number;
}

export interface ChooseImageOptions {
  /** 是否先做内容安全检测（图片会上传服务器的工具必须开启） */
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

/** 选择一张图片，返回 dataURL、本地路径、尺寸与文件大小；可选内容安全检测（违规返回 null） */
export async function chooseImage(
  options: ChooseImageOptions = {},
): Promise<ChosenImage | null> {
  const res = await Taro.chooseImage({
    count: 1,
    sizeType: ['original', 'compressed'],
    sourceType: ['album', 'camera'],
  });
  const filePath = res.tempFilePaths?.[0];
  if (!filePath) return null;

  if (options.secCheck) {
    const small = await makeSecCheckBase64(filePath);
    if (small) {
      const check = await secCheckImage(small);
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

  const fs = Taro.getFileSystemManager();
  const base64 = fs.readFileSync(filePath, 'base64') as string;
  const ext = (filePath.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp'
        ? 'image/webp'
        : 'image/png';
  const info = await Taro.getImageInfo({ src: filePath });
  return {
    dataUrl: `data:${mime};base64,${base64}`,
    filePath,
    width: info.width,
    height: info.height,
    size: res.tempFiles?.[0]?.size ?? 0,
  };
}

/**
 * 把 dataURL 写入本地文件。
 * 小程序 setData 与 Image 组件都不适合直接承载超大 base64，
 * 统一转成文件路径使用。
 */
export async function dataUrlToTempFile(
  dataUrl: string,
  ext = 'png',
): Promise<string> {
  const fs = Taro.getFileSystemManager();
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const filePath = `${Taro.env.USER_DATA_PATH}/itb_${Date.now()}_${Math.floor(
    Math.random() * 1e6,
  )}.${ext}`;
  await new Promise<void>((resolve, reject) => {
    fs.writeFile({
      filePath,
      data: base64,
      encoding: 'base64',
      success: () => resolve(),
      fail: (err) => reject(new Error(err.errMsg || '写入临时文件失败')),
    });
  });
  return filePath;
}

/** 本地文件转 dataURL */
export function fileToDataUrl(filePath: string, mime = 'image/png'): string {
  const fs = Taro.getFileSystemManager();
  const base64 = fs.readFileSync(filePath, 'base64') as string;
  return `data:${mime};base64,${base64}`;
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

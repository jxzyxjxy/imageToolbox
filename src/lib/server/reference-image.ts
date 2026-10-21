import sharp from 'sharp';
import { S3Storage } from 'coze-coding-dev-sdk';

/**
 * 为生图模型准备参考图 URL。
 *
 * - 沙箱环境（配置了 COZE_BUCKET_NAME）：上传对象存储，返回签名 URL；
 * - 自托管环境（未配置对象存储）：压缩为 JPEG data URL 直接传给模型
 *   （SDK 与生图接口均支持 base64 data URI 作为参考图输入）。
 */
export async function resolveReferenceImageUrl(params: {
  buffer: Buffer;
  mime: string;
  ext: string;
  keyPrefix: string;
}): Promise<string> {
  const { buffer, mime, ext, keyPrefix } = params;

  if (process.env.COZE_BUCKET_NAME) {
    const storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: '',
      secretKey: '',
      bucketName: process.env.COZE_BUCKET_NAME,
      region: 'cn-beijing',
    });
    const key = await storage.uploadFile({
      fileContent: buffer,
      fileName: `${keyPrefix}/source_${Date.now()}.${ext}`,
      contentType: mime,
    });
    return storage.generatePresignedUrl({ key, expireTime: 3600 });
  }

  // 自托管：压缩为长边 2048 的 JPEG data URL，控制请求体积。
  // JPEG 不支持透明：含 alpha 的图（如圆角 PNG 素材）必须先铺白底，
  // 否则透明区会被渲染成黑色，生图模型会按"黑底图"生成导致结果带黑边。
  const meta = await sharp(buffer).metadata();
  let pipeline = sharp(buffer).rotate().resize({
    width: 2048,
    height: 2048,
    fit: 'inside',
    withoutEnlargement: true,
  });
  if (meta.hasAlpha) {
    pipeline = pipeline.flatten({ background: '#ffffff' });
  }
  const compressed = await pipeline.jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${compressed.toString('base64')}`;
}

import {
  ImageGenerationClient,
  Config,
} from 'coze-coding-dev-sdk';

interface GenerateImagesParams {
  prompt: string;
  /** 参考图：http(s) URL 或 data URL */
  imageUrl: string;
  /** 尺寸：'2K' 或 '宽x高' */
  size: string;
  watermark?: boolean;
  /** 生成张数，1~4 */
  count?: number;
  forwardHeaders?: Record<string, string>;
}

/**
 * 双通道生图：
 * - 自托管（配置了 ARK_API_KEY）：直连火山引擎方舟（豆包 Seedream），
 *   API Key 长期有效，适合小程序等生产环境；
 * - 沙箱（未配置）：走 Coze 集成网关，行为不变。
 */
export async function generateImages(
  params: GenerateImagesParams,
): Promise<string[]> {
  if (process.env.ARK_API_KEY) {
    return generateWithArk(params);
  }
  return generateWithCoze(params);
}

/** 火山引擎方舟生图（OpenAI 兼容协议） */
async function generateWithArk(
  params: GenerateImagesParams,
): Promise<string[]> {
  const { prompt, imageUrl, size, watermark = false } = params;
  const count = Math.min(4, Math.max(1, Math.round(params.count ?? 1)));
  const baseUrl = (
    process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3'
  ).replace(/\/$/, '');
  const model = process.env.ARK_MODEL || 'doubao-seedream-4-0-20260415';

  const results = await Promise.all(
    Array.from({ length: count }, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);
      try {
        const res = await fetch(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.ARK_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            prompt,
            image: imageUrl,
            size,
            response_format: 'url',
            watermark,
          }),
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          data?: { url?: string }[];
          error?: { message?: string; code?: string };
        };
        if (!res.ok) {
          throw new Error(
            data.error?.message || `方舟接口返回 ${res.status}`,
          );
        }
        const url = data.data?.[0]?.url;
        if (!url) {
          throw new Error('方舟接口未返回图片');
        }
        return url;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('方舟接口请求超时，请重试');
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return results;
}

/** Coze 集成网关生图（沙箱默认路径） */
async function generateWithCoze(
  params: GenerateImagesParams,
): Promise<string[]> {
  const { prompt, imageUrl, size, watermark = false, forwardHeaders } = params;
  const count = Math.min(4, Math.max(1, Math.round(params.count ?? 1)));

  const client = new ImageGenerationClient(new Config(), forwardHeaders);
  const requests = Array.from({ length: count }, () => ({
    prompt,
    image: imageUrl,
    size,
    watermark,
  }));
  const responses = await client.batchGenerate(requests);

  const imageUrls: string[] = [];
  const errors: string[] = [];
  for (const res of responses) {
    const helper = client.getResponseHelper(res);
    if (helper.success && helper.imageUrls.length > 0) {
      imageUrls.push(helper.imageUrls[0]);
    } else {
      errors.push(...helper.errorMessages);
    }
  }
  if (imageUrls.length === 0) {
    throw new Error(errors.join('；') || '生成失败，请重试');
  }
  return imageUrls;
}

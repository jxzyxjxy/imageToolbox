import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

interface AnalyzeResult {
  /** 参考背景色 RGB */
  bg: [number, number, number];
  /** 背景是否相对均匀，便于判断抠图难度 */
  uniform: boolean;
  confidence: number;
  note: string;
}

/**
 * 分析上传图片：识别主体周围的主背景色，供前端抠图/证件照作为参考颜色。
 * Body: { imageBase64: "data:image/jpeg;base64,..." }
 */
export async function POST(request: NextRequest) {
  try {
    const { imageBase64 } = await request.json();
    if (typeof imageBase64 !== 'string' || !imageBase64.startsWith('data:image')) {
      return NextResponse.json({ error: '无效的图片数据' }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    const prompt = [
      '请分析这张图片，识别画面主体的背景颜色。背景通常指人物/物体周围大面积、连续的纯色或接近纯色的区域（例如证件照的白色或蓝色背景、物品拍摄背景等）。',
      '请以严格 JSON 格式返回，不要输出任何其他文字（不要用 markdown 代码块）：',
      '{"bg":[r,g,b],"uniform":true,"confidence":0-1,"note":"一句话说明"}',
      '其中 bg 为该主背景的平均色的 RGB 分量（0-255 整数），uniform 表示背景是否整体均匀接近纯色，confidence 为判断置信度。若画面没有明显的纯色背景，bg 返回图像四角区域的平均色，uniform 返回 false。',
    ].join('\n');

    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: prompt },
          {
            type: 'image_url' as const,
            image_url: { url: imageBase64, detail: 'low' as const },
          },
        ],
      },
    ];

    let raw = '';
    try {
      const response = await client.invoke(messages, {
        model: 'doubao-seed-2-0-pro-260215',
        temperature: 0.2,
        streaming: false,
      });
      raw = response.content || '';
    } catch {
      // 降级：LLM 失败时返回中性灰，前端仍可继续
      raw = '';
    }

    const parsed = extractJson<AnalyzeResult>(raw);
    if (parsed && Array.isArray(parsed.bg) && parsed.bg.length === 3) {
      const bg = parsed.bg.map(Number).map((n) =>
        Math.max(0, Math.min(255, Math.round(n))),
      ) as [number, number, number];
      return NextResponse.json({
        bg,
        uniform: Boolean(parsed.uniform),
        confidence: Number(parsed.confidence) || 0.5,
        note: parsed.note || '',
      });
    }

    // 兜底：返回中性背景色
    return NextResponse.json({
      bg: [128, 128, 128],
      uniform: false,
      confidence: 0.3,
      note: 'AI 分析未返回有效结果，已使用兜底背景色。',
    });
  } catch (error) {
    console.error('analyze route error:', error);
    return NextResponse.json(
      { error: '背景分析失败，请重试' },
      { status: 500 },
    );
  }
}

/** 从文本中稳健地提取 JSON 对象 */
function extractJson<T>(text: string): T | null {
  if (!text) return null;
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
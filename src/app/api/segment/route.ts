import { handleSegment } from '@/lib/server/tool-handlers';

export const runtime = 'nodejs';

// AI 人像/主体分割（ISNet，本地推理，不产生外部 API 费用）
export async function POST(request: Request) {
  const body = (await request.json()) as { imageBase64?: string };
  return handleSegment(body);
}

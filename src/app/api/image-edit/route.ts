import { NextRequest } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { handleImageEdit, type EditMode } from '@/lib/server/tool-handlers';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { imageBase64?: string; mode?: EditMode };
  const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  return handleImageEdit(body, forwardHeaders);
}

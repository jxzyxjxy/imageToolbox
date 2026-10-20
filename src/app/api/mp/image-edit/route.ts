import { NextRequest } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { handleImageEdit, type EditMode } from '@/lib/server/tool-handlers';
import { guardMpRequest } from '@/lib/server/mp-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const denied = guardMpRequest(request, 'image-edit');
  if (denied) return denied;
  const body = (await request.json()) as { imageBase64?: string; mode?: EditMode };
  const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  return handleImageEdit(body, forwardHeaders);
}

import { NextRequest } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { handleSimilar, type SimilarBody } from '@/lib/server/tool-handlers';
import { guardMpRequest } from '@/lib/server/mp-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const denied = guardMpRequest(request, 'similar');
  if (denied) return denied;
  const body: SimilarBody = await request.json();
  const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  return handleSimilar(body, forwardHeaders);
}

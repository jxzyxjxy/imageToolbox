import { NextRequest } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { handleSimilar, type SimilarBody } from '@/lib/server/tool-handlers';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body: SimilarBody = await request.json();
  const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  return handleSimilar(body, forwardHeaders);
}

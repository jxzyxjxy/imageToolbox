import { handleSegment } from '@/lib/server/tool-handlers';
import { guardMpRequest } from '@/lib/server/mp-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const denied = guardMpRequest(request, 'segment');
  if (denied) return denied;
  const body = (await request.json()) as { imageBase64?: string };
  return handleSegment(body);
}

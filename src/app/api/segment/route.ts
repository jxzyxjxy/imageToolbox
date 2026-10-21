import { NextRequest } from 'next/server';
import { handleSegment } from '@/lib/server/tool-handlers';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { imageBase64?: string };
  return handleSegment(body);
}

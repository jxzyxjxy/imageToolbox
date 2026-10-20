/**
 * 微信小程序调用票据（HMAC-SHA256）校验。
 * 票据由微信云函数 ticket 签发，格式：base64url(JSON payload) + '.' + base64url(HMAC)。
 * 小程序请求 /api/mp/* 时在 header `x-mp-ticket` 中携带，服务端验签 + 校验工具名与有效期。
 */
import crypto from 'crypto';
import { NextResponse } from 'next/server';

export interface ToolTicketPayload {
  openid: string;
  tool: string;
  /** 过期时间（毫秒时间戳） */
  exp: number;
  nonce: string;
}

function getSecret(): string | undefined {
  return process.env.MP_TICKET_SECRET;
}

/** 服务端自签（仅供云函数同款算法参考/测试使用） */
export function signToolTicket(payload: ToolTicketPayload): string {
  const secret = getSecret();
  if (!secret) throw new Error('MP_TICKET_SECRET 未配置');
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyToolTicket(
  ticket: string | null,
  tool: string,
): { ok: true; openid: string } | { ok: false; error: string } {
  const secret = getSecret();
  if (!secret) {
    return { ok: false, error: '服务端未配置 MP_TICKET_SECRET' };
  }
  if (!ticket) {
    return { ok: false, error: '缺少调用票据，请重新进入小程序' };
  }
  const dot = ticket.lastIndexOf('.');
  if (dot <= 0) {
    return { ok: false, error: '票据格式无效' };
  }
  const payloadB64 = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  const expect = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expect, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: '票据签名无效' };
  }
  let payload: ToolTicketPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: '票据解析失败' };
  }
  if (payload.tool !== tool) {
    return { ok: false, error: '票据与调用工具不匹配' };
  }
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    return { ok: false, error: '票据已过期，请重试' };
  }
  return { ok: true, openid: payload.openid };
}

/**
 * /api/mp/* 路由入口守卫：验票通过返回 null 继续处理；
 * 否则直接返回 401 响应（前端拿到 401 会自动重新取票重试一次）。
 */
export function guardMpRequest(request: Request, tool: string): NextResponse | null {
  const ticket = request.headers.get('x-mp-ticket');
  const result = verifyToolTicket(ticket, tool);
  if (result.ok) return null;
  return NextResponse.json({ error: result.error }, { status: 401 });
}

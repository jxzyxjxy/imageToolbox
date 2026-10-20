import Taro from '@tarojs/taro';
import { BASE_URL } from '@/config';
import { fetchTicket } from './cloud';

interface ApiError {
  error?: string;
}

/** 需要云函数票据的工具接口（路径 → 工具名） */
const TICKET_TOOLS: Record<string, string> = {
  '/api/mp/similar': 'similar',
  '/api/mp/image-edit': 'image-edit',
  '/api/mp/segment': 'segment',
};

interface CachedTicket {
  ticket: string;
  /** 本地缓存过期时间（服务端 5 分钟，客户端提前 1 分钟失效） */
  exp: number;
}

const ticketCache = new Map<string, CachedTicket>();

async function getCachedTicket(tool: string): Promise<string> {
  const cached = ticketCache.get(tool);
  if (cached && Date.now() < cached.exp) return cached.ticket;
  const res = await fetchTicket(tool);
  ticketCache.set(tool, {
    ticket: res.ticket as string,
    exp: Date.now() + 4 * 60 * 1000,
  });
  return res.ticket as string;
}

async function rawPost(
  path: string,
  data: Record<string, unknown>,
  ticket?: string,
): Promise<Taro.request.SuccessCallbackResult> {
  const header: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ticket) header['x-mp-ticket'] = ticket;
  return Taro.request({
    url: BASE_URL + path,
    method: 'POST',
    data,
    header,
    timeout: 180000,
  });
}

function unwrap<T>(res: Taro.request.SuccessCallbackResult): T {
  const body = res.data as (T & ApiError) | undefined;
  if (res.statusCode !== 200) {
    throw new Error(body?.error || `请求失败（${res.statusCode}）`);
  }
  if (body && typeof body === 'object' && body.error) {
    throw new Error(body.error);
  }
  return body as T;
}

/**
 * POST JSON 并返回业务数据。
 * /api/mp/* 接口自动携带云函数票据；401（票据过期/无效）时刷新票据重试一次。
 */
export async function post<T>(
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const tool = TICKET_TOOLS[path];
  if (!tool) {
    return unwrap<T>(await rawPost(path, data));
  }
  let ticket = await getCachedTicket(tool);
  let res = await rawPost(path, data, ticket);
  if (res.statusCode === 401) {
    ticketCache.delete(tool);
    ticket = await getCachedTicket(tool);
    res = await rawPost(path, data, ticket);
  }
  return unwrap<T>(res);
}

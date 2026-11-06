import type { ParseVideoResponse } from '@/api/client';

/**
 * 解析页 → 结果页数据传递。
 * 解析结果（含多条直链/候选数组）体积大，不适合 navigateTo URL 传参，
 * 用模块级缓存（页面栈存活期内有效）；结果页读不到时提示返回重新解析。
 */
export interface ParseResultPayload {
  result: ParseVideoResponse;
  /** 原始分享文本（下载失败 forceRelay 二次解析需要） */
  text: string;
}

export const parseResultCache: { data: ParseResultPayload | null } = { data: null };

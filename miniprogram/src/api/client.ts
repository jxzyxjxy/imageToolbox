/**
 * AI 工具统一客户端：全部走微信云开发云函数，图片经云存储中转。
 * 流程：chooseImage（本地选图+安全检测）→ uploadImage（云存储）→ 云函数处理 → fileID 结果。
 */
import { callCloud } from './cloud';

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * AI 工具云函数统一封装。兜底超时 70s：大模型出图需 20~40s+，
 * 且略高于云函数控制台 60s 超时上限，让云函数自身的超时错误优先传回
 * （此前误用 callCloud 的 15s 默认值，导致 AI 工具十几秒就报"云函数超时"）。
 */
async function callTool<T extends { error?: string; code?: string }>(
  name: string,
  data: Record<string, unknown>,
): Promise<T> {
  const res = await callCloud<T>(name, data, 70000);
  if (res && typeof res === 'object' && res.error) {
    throw new ApiError(res.error, res.code);
  }
  return res;
}

/* ---------- 生成相似图 ---------- */

export interface SimilarOptions {
  width?: number;
  height?: number;
  similarity?: number;
  count?: number;
  modelKey?: string;
  transparent?: boolean;
}

export interface GenerateResultItem {
  fileID: string;
  width?: number;
  height?: number;
}

export interface SimilarResponse {
  results: GenerateResultItem[];
  remaining?: number;
  limit?: number;
  size?: string;
  format?: string;
  error?: string;
  code?: string;
}

export async function generateSimilar(
  inputFileID: string,
  opts: SimilarOptions = {},
): Promise<SimilarResponse> {
  return callTool<SimilarResponse>('yt_generate', {
    tool: 'similar',
    fileID: inputFileID,
    ...opts,
  });
}

/* ---------- 图像编辑：去水印 / 智能消除 / 老照片修复 ---------- */

export type EditMode = 'watermark' | 'object' | 'restore';

export async function generateEdit(
  inputFileID: string,
  mode: EditMode,
): Promise<SimilarResponse> {
  return callTool<SimilarResponse>('yt_generate', {
    tool: mode,
    fileID: inputFileID,
  });
}

/* ---------- AI 主体分割（证件照/智能抠图） ---------- */

export interface SegmentResponse {
  fileID?: string;
  width?: number;
  height?: number;
  remaining?: number;
  limit?: number;
  error?: string;
  code?: string;
}

export async function segmentImage(inputFileID: string): Promise<SegmentResponse> {
  return callTool<SegmentResponse>('yt_segment', { fileID: inputFileID });
}

/* ---------- 图标拆分 ---------- */

export interface SplitIconItem {
  name: string;
  fileID: string;
  w: number;
  h: number;
}

export interface SplitIconsResponse {
  icons?: SplitIconItem[];
  spriteFileID?: string;
  spriteMeta?: {
    cols: number;
    rows: number;
    cellW: number;
    cellH: number;
    gap: number;
    items: { index: number; name: string; x: number; y: number; w: number; h: number }[];
  };
  note?: string;
  remaining?: number;
  limit?: number;
  error?: string;
  code?: string;
}

export interface SplitIconsOptions {
  targetSize?: number;
  cols?: number;
  gap?: number;
}

export async function splitIcons(
  inputFileID: string,
  opts: SplitIconsOptions = {},
): Promise<SplitIconsResponse> {
  return callTool<SplitIconsResponse>('yt_split_icons', {
    fileID: inputFileID,
    ...opts,
  });
}

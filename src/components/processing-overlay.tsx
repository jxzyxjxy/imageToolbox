'use client';

import { Loader2 } from 'lucide-react';

interface ProcessingOverlayProps {
  label?: string;
  hint?: string;
}

/** 全屏处理中遮罩：图片上传 / AI 处理期间的统一任务反馈 */
export function ProcessingOverlay({
  label = '处理中…',
  hint = '图片正在上传，请稍候',
}: ProcessingOverlayProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/20 px-6 backdrop-blur-[2px]">
      <div className="flex w-full max-w-[300px] flex-col items-center gap-3 rounded-[24px] bg-white/95 px-8 py-7 shadow-[0_16px_48px_rgba(30,41,59,0.22)]">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#a855f7] text-white shadow-[0_10px_20px_rgba(99,102,241,0.32)]">
          <Loader2 className="h-6 w-6 animate-spin" />
        </span>
        <p className="text-[15px] font-semibold text-[#1e293b]">{label}</p>
        <p className="text-xs text-[#94a3b8]">{hint}</p>
      </div>
    </div>
  );
}

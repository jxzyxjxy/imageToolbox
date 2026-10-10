'use client';

import { Loader2 } from 'lucide-react';

interface BottomBarProps {
  onPrimary: () => void;
  onSecondary?: () => void;
  primaryLabel: string;
  secondaryLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}

export function BottomBar({
  onPrimary,
  onSecondary,
  primaryLabel,
  secondaryLabel = '重置',
  disabled = false,
  loading = false,
  loadingLabel = '处理中',
}: BottomBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] border-t border-slate-100 bg-white/90 px-4 pb-[max(env(safe-area-inset-bottom),14px)] pt-3 backdrop-blur">
      <div className="flex gap-3">
        {onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            className="h-12 shrink-0 rounded-2xl border border-slate-200 bg-white px-5 text-[15px] font-semibold text-[#64748b] transition-transform duration-200 active:scale-95"
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onPrimary}
          disabled={disabled || loading}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6366f1] via-[#8b5cf6] to-[#a855f7] text-[15px] font-semibold text-white shadow-[0_10px_24px_rgba(139,92,246,0.35)] transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? loadingLabel : primaryLabel}
        </button>
      </div>
    </div>
  );
}
import { type ReactNode } from 'react';

interface BottomBarProps {
  children: ReactNode;
}

/**
 * 移动端固定底部操作栏：覆盖整个视口底部，但内容收敛到与页面同宽的
 * 430px 手机容器内；自带安全区 padding。使用页面需在内容底部预留 pb-24。
 */
export default function BottomBar({ children }: BottomBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30">
      <div
        className="mx-auto w-full max-w-[430px] border-t border-black/[0.05] bg-white/90 px-4 pt-3 backdrop-blur-md"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
      >
        {children}
      </div>
    </div>
  );
}
import { PropsWithChildren, useEffect } from 'react';
import { CLOUD_ENV } from '@/config';
import { mpLogin } from '@/api/cloud';
import './app.scss';

function App({ children }: PropsWithChildren) {
  useEffect(() => {
    // 版本横幅：确认工具里跑的是哪次构建（排查"改了没生效"类问题）
    console.log('[YT-VER] v20261030-a 路标诊断版');
    // 初始化微信云开发（仅在小程序环境）
    const g = globalThis as unknown as {
      wx?: { cloud?: { init: (o: { env: string; traceUser?: boolean }) => void } };
    };
    if (g.wx?.cloud && CLOUD_ENV && CLOUD_ENV !== 'your-cloud-env-id') {
      console.log('[cloud] init 环境就绪:', CLOUD_ENV);
      g.wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
      // 启动登录：openid 落库，供限频/未来的 VIP 权益使用
      void mpLogin().then(() => console.log('[cloud] 启动登录完成')).catch((e: unknown) => console.warn('[cloud] 启动登录失败:', e));
    } else {
      console.warn('[cloud] 云环境 ID 未配置，票据类接口将不可用（开发期可在 config.ts 配置）');
    }
  }, []);

  // children 是将要会渲染的页面
  return children;
}

export default App;

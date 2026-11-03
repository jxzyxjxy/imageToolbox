/// <reference types="@tarojs/taro" />

/** 微信小程序全局对象（最小声明：仅覆盖项目用到的 wx.cloud 能力） */
declare namespace WechatMinigame {
  interface WxCloudDatabaseCollection {
    add(o: { data: Record<string, unknown> }): { catch(fn: (e: unknown) => void): void };
  }
  interface WxCloud {
    init(o: { env: string; traceUser?: boolean }): void;
    database(): {
      collection(name: string): WxCloudDatabaseCollection;
    };
  }
}
declare const wx: {
  cloud?: WechatMinigame.WxCloud;
};

declare module '*.png';
declare module '*.gif';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.css';
declare module '*.less';
declare module '*.scss';
declare module '*.sass';

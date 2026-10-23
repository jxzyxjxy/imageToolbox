/**
 * 插屏广告（进入首页时展示）。
 * 需在 mp.weixin.qq.com 开通流量主并创建插屏广告位，把 adUnitId 填到 config.ts。
 * 流量主开通门槛：小程序累计独立访客（UV）≥ 1000。未配置时全部静默跳过。
 */
import Taro from '@tarojs/taro';
import { AD_UNIT_INTERSTITIAL } from '@/config';

type InterstitialAd = ReturnType<typeof Taro.createInterstitialAd>;

let ad: InterstitialAd | null = null;
let shownThisLaunch = false;

/** 尝试展示插屏广告；每次冷启动最多展示一次，任何失败均静默 */
export function maybeShowInterstitialAd(): void {
  if (shownThisLaunch) return;
  if (!AD_UNIT_INTERSTITIAL) return;
  try {
    if (!ad) {
      ad = Taro.createInterstitialAd({ adUnitId: AD_UNIT_INTERSTITIAL });
      ad.onError((e: unknown) => console.warn('[ad] 插屏广告错误:', e));
      ad.onClose(() => console.log('[ad] 插屏广告关闭'));
    }
    ad.load()
      .then(() => {
        shownThisLaunch = true;
        return ad!.show();
      })
      .catch((e: unknown) => console.warn('[ad] 插屏广告加载失败:', e));
  } catch (e) {
    console.warn('[ad] 插屏广告不可用:', e);
  }
}

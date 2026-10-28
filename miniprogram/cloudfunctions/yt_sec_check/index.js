// 图片内容安全检测：传入压缩小图的 base64（≤750px / ≤500KB），违规则拦截
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const imageBase64 = event && event.imageBase64;
  const text = event && event.text;
  if (!imageBase64 && !text) return { pass: false, error: '缺少待检测内容' };

  try {
    if (text) {
      // 文本检测（昵称等 UGC 文案）
      await cloud.openapi.security.msgSecCheck({ content: String(text).slice(0, 2500) });
      return { pass: true };
    }
    await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: 'image/png',
        value: Buffer.from(imageBase64, 'base64'),
      },
    });
    return { pass: true };
  } catch (err) {
    // 87014 = 内容违规
    if (err && err.errCode === 87014) {
      return { pass: false, error: text ? '昵称包含违规内容，请更换' : '图片包含违规内容，无法使用该功能' };
    }
    // 检测服务异常时放行（避免误杀正常用户），但记录日志便于排查
    console.error('[sec-check] 检测异常:', err);
    return { pass: true };
  }
};

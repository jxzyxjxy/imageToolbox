// 图片内容安全检测：传入压缩小图的 base64（≤750px / ≤500KB），违规则拦截
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const imageBase64 = event && event.imageBase64;
  if (!imageBase64) return { pass: false, error: '缺少图片数据' };

  try {
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
      return { pass: false, error: '图片包含违规内容，无法使用该功能' };
    }
    // 检测服务异常时放行（避免误杀正常用户），但记录日志便于排查
    console.error('[sec-check] 检测异常:', err);
    return { pass: true };
  }
};

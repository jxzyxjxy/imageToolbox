// 登录：小程序启动时调用，openid 落库 users 集合（不存在则创建档案）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { error: '获取用户身份失败' };

  const users = db.collection('users');
  try {
    const exist = await users.where({ openid: OPENID }).limit(1).get();
    if (exist.data.length === 0) {
      await users.add({
        data: { openid: OPENID, createdAt: Date.now(), vipLevel: 0, vipExpire: 0 },
      });
    }
  } catch (e) {
    // users 集合不存在时给出明确提示（需在微信云开发控制台手动创建）
    console.error('[login] 用户落库失败:', e);
    return { error: '用户初始化失败，请检查云数据库 users 集合' };
  }
  return { openid: OPENID };
};

// 登录与用户档案：openid 落库 users 集合；支持头像昵称读写
// action: 'get'（默认，启动调用）/ 'updateProfile'（保存昵称头像）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function toProfile(doc, openid) {
  return {
    openid,
    nickname: (doc && doc.nickname) || '',
    avatarFileID: (doc && doc.avatarFileID) || '',
    vipLevel: (doc && doc.vipLevel) || 0,
    vipExpire: (doc && doc.vipExpire) || 0,
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { error: '获取用户身份失败' };

  const users = db.collection('yt_users');
  try {
    const exist = await users.where({ openid: OPENID }).limit(1).get();
    let doc = exist.data[0];
    if (!doc) {
      const added = await users.add({
        data: { openid: OPENID, createdAt: Date.now(), nickname: '', avatarFileID: '', vipLevel: 0, vipExpire: 0 },
      });
      doc = { _id: added._id, openid: OPENID };
    }

    const action = (event && event.action) || 'get';
    if (action === 'updateProfile') {
      const nickname = typeof event.nickname === 'string' ? event.nickname.trim().slice(0, 24) : '';
      const avatarFileID = typeof event.avatarFileID === 'string' ? event.avatarFileID : '';
      if (!nickname) return { error: '昵称不能为空' };
      if (avatarFileID && !avatarFileID.startsWith('cloud://')) return { error: '头像地址无效' };
      await users.doc(doc._id).update({
        data: { nickname, avatarFileID, updatedAt: Date.now() },
      });
      doc.nickname = nickname;
      doc.avatarFileID = avatarFileID;
    }

    return toProfile(doc, OPENID);
  } catch (e) {
    console.error('[login] 失败:', e);
    return { error: '用户初始化失败，请检查云数据库 users 集合' };
  }
};

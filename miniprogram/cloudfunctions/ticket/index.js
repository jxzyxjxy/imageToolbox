// 工具调用票据签发：每日免费额度限频 + HMAC 签名票据（ECS /api/mp/* 验签放行）
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 每日免费额度（按工具，未来接 VIP 时在此按 vipLevel 分层）
const DAILY_LIMITS = {
  'similar': 3,     // 生成相似图（方舟按张计费）
  'image-edit': 3,  // 去水印/智能消除/老照片修复（方舟按张计费）
  'segment': 10,    // AI 抠图（本地推理零成本，宽松些）
};

const TICKET_TTL = 5 * 60 * 1000; // 票据有效期 5 分钟

function todayCN() {
  // 按 UTC+8 取日期串，作为每日额度边界
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { error: '获取用户身份失败' };

  const tool = event && event.tool;
  const limit = DAILY_LIMITS[tool];
  if (!limit) return { error: '未知的工具类型' };

  const secret = process.env.MP_TICKET_SECRET;
  if (!secret) return { error: '云函数未配置 MP_TICKET_SECRET' };

  const date = todayCN();
  const usage = db.collection('usage');
  const key = `${OPENID}_${tool}_${date}`;

  let count = 0;
  try {
    const got = await usage.doc(key).get().catch(() => null);
    count = got && got.data ? got.data.count : 0;

    if (count >= limit) {
      return { error: `今日免费次数已用完（${limit} 次/天），明天再来吧`, remaining: 0, limit };
    }

    if (got && got.data) {
      await usage.doc(key).update({ data: { count: _.inc(1) } });
    } else {
      // 首次使用：_id 做幂等键，并发 add 冲突时退化为 inc
      await usage
        .add({ data: { _id: key, openid: OPENID, tool, date, count: 1 } })
        .catch(() => usage.doc(key).update({ data: { count: _.inc(1) } }));
    }
  } catch (e) {
    console.error('[ticket] 额度记录失败:', e);
    return { error: '额度校验失败，请检查云数据库 usage 集合' };
  }

  const payload = {
    openid: OPENID,
    tool,
    exp: Date.now() + TICKET_TTL,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  return {
    ticket: `${payloadB64}.${sig}`,
    remaining: limit - count - 1,
    limit,
  };
};

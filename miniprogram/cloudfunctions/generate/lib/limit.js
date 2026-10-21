/**
 * 每日免费限频：usage 集合按 openid+日期+工具 计数，原子自增占座。
 * 文档 _id = `${openid}_${date}_${tool}`，字段 { openid, date, tool, count }。
 */
const QUOTA = {
  similar: 3, // 生成相似图
  watermark: 3, // 去水印
  object: 3, // 智能消除
  restore: 3, // 老照片修复
  segment: 10, // AI 抠图（证件照/智能抠图共用）
  'split-icons': 10, // 图标拆分
};

function today() {
  // 北京时间 YYYY-MM-DD
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

async function getCount(col, id) {
  try {
    const doc = await col.doc(id).get();
    return (doc.data && doc.data.count) || 0;
  } catch (e) {
    return 0;
  }
}

function limitError(limit) {
  return {
    ok: false,
    code: 'LIMIT',
    remaining: 0,
    limit,
    error: `今日免费次数已用完（每天 ${limit} 次），明天再来`,
  };
}

/** 占用一次额度。返回 { ok, remaining, limit, error?, code? } */
async function consume(db, openid, tool) {
  const limit = QUOTA[tool];
  if (!limit) return { ok: false, error: '未知工具: ' + tool };
  const _ = db.command;
  const col = db.collection('usage');
  const id = `${openid}_${today()}_${tool}`;

  const inc = await col
    .where({ _id: id, count: _.lt(limit) })
    .update({ count: _.inc(1) })
    .catch(() => ({ updated: 0 }));

  if (inc.updated === 1) {
    const used = await getCount(col, id);
    return { ok: true, remaining: Math.max(0, limit - used), limit };
  }

  // updated=0：首次使用（文档不存在）或已超限
  const used = await getCount(col, id);
  if (used >= limit) return limitError(limit);

  try {
    await col.doc(id).set({ data: { openid, date: today(), tool, count: 1 } });
    return { ok: true, remaining: limit - 1, limit };
  } catch (e) {
    // 并发首建冲突，重试一次原子自增
    const retry = await col
      .where({ _id: id, count: _.lt(limit) })
      .update({ count: _.inc(1) })
      .catch(() => ({ updated: 0 }));
    if (retry.updated === 1) {
      const used2 = await getCount(col, id);
      return { ok: true, remaining: Math.max(0, limit - used2), limit };
    }
    return limitError(limit);
  }
}

module.exports = { consume, QUOTA };

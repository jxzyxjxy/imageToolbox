/**
 * 定时清理云存储临时文件
 * - 触发：config.json 定时触发器，每天凌晨执行
 * - 数据源：yt_storage_files 集合（inputs/results 文件上传后登记）
 * - 策略：inputs 保留 1 天，results 保留 7 天，avatars 不登记不清理
 * - 兜底：storage_files 中 fileID 已被手动删除的记录一并清除
 * 手动触发（event = { all: true }）时删除全部已登记的临时文件，便于一次性清空。
 */
const cloud = require('wx-server-sdk');

const RETENTION_MS = {
  inputs: 24 * 3600e3, // 输入中转图 1 天
  results: 7 * 24 * 3600e3, // 结果图 7 天
};

const BATCH = 20; // 单批删除数量，控制函数耗时
const MAX_BATCHES = 25; // 单次调用最多处理批数（500 条），剩余下次再清

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function kindOf(fileID) {
  if (fileID.includes('/inputs/')) return 'inputs';
  if (fileID.includes('/results/')) return 'results';
  return null;
}

exports.main = async (event = {}) => {
  const db = cloud.database();
  const col = db.collection('yt_storage_files');
  const now = Date.now();

  // 查全部已登记文件，本地按种类保留期过滤（集合量 = 最近 7 天产物，规模可控）
  const { data } = await col.where({ purged: db.command.neq(true) }).limit(1000).get();

  const expired = [];
  for (const rec of data) {
    const kind = kindOf(rec.fileID);
    if (!kind) continue;
    const ttl = RETENTION_MS[kind];
    const ts = rec.createdAt ? new Date(rec.createdAt).getTime() : 0;
    if (event.all || !ttl || now - ts > ttl) expired.push(rec);
  }

  let deletedFiles = 0;
  let missingRecords = 0;
  const batches = Math.min(Math.ceil(expired.length / BATCH), MAX_BATCHES);

  for (let b = 0; b < batches; b++) {
    const slice = expired.slice(b * BATCH, (b + 1) * BATCH);
    const fileIDs = slice.map((r) => r.fileID);

    const results = await cloud.deleteFile({ fileList: fileIDs });
    const idsToMark = [];
    for (let i = 0; i < results.fileList.length; i++) {
      const item = results.fileList[i];
      // 0=成功；-502001 file not found=已被手动删除，记录一并清掉
      if (item.status === 0 || item.status === -502001) {
        idsToMark.push(slice[i]._id);
        deletedFiles += 1;
        if (item.status === -502001) missingRecords += 1;
      }
    }
    // 标记已清理（软标记，保留记录便于排查；也可直接 remove）
    for (const id of idsToMark) {
      await col.doc(id).update({ data: { purged: true, purgedAt: new Date() } });
    }
  }

  // 顺带清理 30 天前的 purged 记录，防止集合膨胀
  let purgedRecordsRemoved = 0;
  try {
    const old = await col
      .where({ purged: true, purgedAt: db.command.lt(new Date(now - 30 * 24 * 3600e3)) })
      .limit(100)
      .get();
    for (const rec of old.data) {
      await col.doc(rec._id).remove();
      purgedRecordsRemoved += 1;
    }
  } catch (e) {
    // 集合不存在等异常不影响主流程
  }

  const leftOver = expired.length - batches * BATCH;
  return {
    ok: true,
    scanned: data.length,
    expired: expired.length,
    deletedFiles,
    missingRecords,
    purgedRecordsRemoved,
    leftOver: Math.max(leftOver, 0),
  };
};

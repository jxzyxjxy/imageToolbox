/** 云存储读写：输入图下载、结果图上传；上传后登记到 storage_files 供定时清理 */

function resultPath(openid, ext) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `results/${String(openid).slice(-8)}/${Date.now()}_${rand}.${ext}`;
}

/** 下载云存储文件，返回 Buffer */
async function download(cloud, fileID) {
  const res = await cloud.downloadFile({ fileID });
  return res.fileContent;
}

/** 登记临时文件（按 fileID 去重；失败不阻断业务，清理函数按记录清理） */
async function register(cloud, fileID, kind, openid) {
  try {
    const db = cloud.database();
    const existed = await db.collection('storage_files').where({ fileID }).limit(1).get();
    if (existed.data && existed.data.length > 0) return;
    await db.collection('storage_files').add({
      data: { fileID, kind, openid: openid || '', createdAt: new Date() },
    });
  } catch (e) {
    console.warn('[storage] register failed:', e && e.errMsg ? e.errMsg : e);
  }
}

/** 上传结果图，返回 fileID（同时登记 results，保留 7 天） */
async function upload(cloud, openid, buffer, ext) {
  const res = await cloud.uploadFile({
    cloudPath: resultPath(openid, ext),
    fileContent: buffer,
  });
  await register(cloud, res.fileID, 'results', openid);
  return res.fileID;
}

module.exports = { download, upload, resultPath, register };

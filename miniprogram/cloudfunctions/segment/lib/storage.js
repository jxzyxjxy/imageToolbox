/** 云存储读写：输入图下载、结果图上传（结果路径按用户区分，生命周期由控制台规则清理） */

function resultPath(openid, ext) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `results/${String(openid).slice(-8)}/${Date.now()}_${rand}.${ext}`;
}

/** 下载云存储文件，返回 Buffer */
async function download(cloud, fileID) {
  const res = await cloud.downloadFile({ fileID });
  return res.fileContent;
}

/** 上传结果图，返回 fileID */
async function upload(cloud, openid, buffer, ext) {
  const res = await cloud.uploadFile({
    cloudPath: resultPath(openid, ext),
    fileContent: buffer,
  });
  return res.fileID;
}

module.exports = { download, upload, resultPath };

/**
 * miniapp 函数用的云存储适配（和 server/cloud.ts 里 sales 用的同一套写法）。
 * 单独抄一份而不是从 cloud.ts 导出：改 cloud.ts 会让 sales 函数包变样（sales 包必须逐字节不变）。
 */
import type { AvatarStorage } from "../avatar";
import type { ReceiptStorage } from "../receipts";

async function tempUrls(app: any, fileIDs: string[]) {
  const r = await app.getTempFileURL({ fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 7200 })) });
  const out = new Map<string, string>();
  for (const f of r?.fileList ?? []) if (f?.tempFileURL && (!f.code || f.code === "SUCCESS")) out.set(f.fileID, f.tempFileURL);
  return out;
}
async function upload(app: any, cloudPath: string, bytes: Uint8Array) {
  const r = await app.uploadFile({ cloudPath, fileContent: Buffer.from(bytes) });
  if (!r?.fileID) throw new Error("upload failed");
  return r.fileID as string;
}
export function cloudAvatarStorage(app: any): AvatarStorage {
  return {
    upload: (cloudPath, bytes) => upload(app, cloudPath, bytes),
    async remove(fileID) {
      const r = await app.deleteFile({ fileList: [fileID] });
      const item = r?.fileList?.[0];
      if (item && item.code && item.code !== "SUCCESS") throw new Error("delete failed");
    },
    tempUrls: (fileIDs) => tempUrls(app, fileIDs),
  };
}
export function cloudReceiptStorage(app: any): ReceiptStorage {
  return {
    async ticket(cloudPath) {
      const r = await app.getUploadMetadata({ cloudPath });
      const d = r?.data;
      if (!d?.url || !d?.authorization || !d?.fileId) return null;
      return {
        url: d.url as string,
        headers: {
          authorization: d.authorization,
          "x-cos-security-token": d.token || "",
          "x-cos-meta-fileid": d.cosFileId || "",
        },
        fileID: d.fileId as string,
      };
    },
    upload: (cloudPath, bytes) => upload(app, cloudPath, bytes),
    async remove(fileIDs) {
      await app.deleteFile({ fileList: fileIDs });
    },
    tempUrls: (fileIDs) => tempUrls(app, fileIDs),
  };
}

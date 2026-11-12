import cloudbase from "@cloudbase/node-sdk";
import { createHash } from "node:crypto";
import { CloudStore } from "./cloud-store";
import { handle } from "./handler";
import { handleSync, parseSyncEvent, rateLimiter, syncFailure } from "./task-sync";
import { pushAction, pushConfigFromEnv } from "./push";
import { webPushSender } from "./reminder-cloud";
import { appendOnly, auditSync } from "./audit";
import { ownerOn, teamConfigFromEnv } from "./team";
import type { AvatarStorage } from "./avatar";

// 单实例内存限流（兜底，主防线是控制台限流）
const syncLimit = rateLimiter();

/** CloudBase 云存储（服务端权限）：只给头像用，网页不直接读写 */
function cloudAvatarStorage(app: any): AvatarStorage {
  return {
    async upload(cloudPath, bytes) {
      const r = await app.uploadFile({ cloudPath, fileContent: Buffer.from(bytes) });
      if (!r?.fileID) throw new Error("upload failed");
      return r.fileID as string;
    },
    async remove(fileID) {
      const r = await app.deleteFile({ fileList: [fileID] });
      const item = r?.fileList?.[0];
      if (item && item.code && item.code !== "SUCCESS") throw new Error("delete failed");
    },
    async tempUrls(fileIDs) {
      const r = await app.getTempFileURL({ fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 7200 })) });
      const out = new Map<string, string>();
      for (const f of r?.fileList ?? []) if (f?.tempFileURL && (!f.code || f.code === "SUCCESS")) out.set(f.fileID, f.tempFileURL);
      return out;
    },
  };
}

export async function main(event: unknown, context: any) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  // 团队开关：MEMBERS_ENABLED=1 / AUDIT_ENABLED=1 才开启，缺省全关（与原来一致）
  // 日程归属 SCHEDULE_OWNER_ENABLED、头像 AVATARS_ENABLED、sales 新字段 SALES_ACTOR_FIELDS_ENABLED：缺省全关
  const team = {
    ...teamConfigFromEnv(process.env),
    avatarStorage: cloudAvatarStorage(app),
    warn: (code: string) => console.warn("sales team", code),
  };
  // iPhone 提醒事项同步：HTTP 访问或带 syncKey 的调用只走同步接口，不进入私人账本的其他操作。
  let sync;
  try {
    sync = parseSyncEvent(event);
  } catch (error) {
    // 只透出 SyncError；其他错误统一通用提示，不外泄原始报错。
    return syncFailure(error);
  }
  if (sync) {
    const result = await handleSync(() => new CloudStore(app.database()), {
      key: process.env.TASK_SYNC_KEY,
      now: () => new Date().toISOString(),
      hash: async (value: string) => createHash("sha256").update(value).digest("hex"),
      limit: syncLimit,
      // 日程归属开：只同步归 Jason 的日程 + 撤下清单
      ...(ownerOn(team) && process.env.OWNER_UID ? { owner: process.env.OWNER_UID } : {}),
    }, sync);
    // 同步接口的行为不变，只在 AUDIT_ENABLED 时追加一条日志（日志失败不影响返回）
    if (team.auditEnabled)
      await auditSync(
        appendOnly(new CloudStore(app.database()), () => new Date().toISOString(), (code) => console.warn("sales audit", code)),
        sync,
        result as { ok: boolean; code?: string; data?: unknown },
        undefined,
        undefined,
        (code) => console.warn("sales audit", code),
      ).catch(() => console.warn("sales audit", "audit.sync_failed"));
    return result;
  }
  const auth = await app.auth().getAuthContext(context);
  const ownerContext = {
    uid: auth.uid || null,
    ownerUid: process.env.OWNER_UID || "",
    hash: async (value: string) => createHash("sha256").update(value).digest("hex"),
  };
  const pushConfig = pushConfigFromEnv();
  return handle(
    () => new CloudStore(app.database()),
    ownerContext,
    event,
    (code) => console.warn("sales request failed", code),
    (store, action, payload) => pushAction(store, ownerContext, action, payload, pushConfig, webPushSender(pushConfig)),
    team,
  );
}

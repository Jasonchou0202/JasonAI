import cloudbase from "@cloudbase/node-sdk";
import { createHash } from "node:crypto";
import { CloudStore } from "./cloud-store";
import { handle } from "./handler";
import { handleSync, parseSyncEvent, rateLimiter, syncFailure } from "./task-sync";
import { pushAction, pushConfigFromEnv } from "./push";
import { webPushSender } from "./reminder-cloud";
import { appendOnly, auditSync } from "./audit";
import { teamConfigFromEnv } from "./team";

// 单实例内存限流（兜底，主防线是控制台限流）
const syncLimit = rateLimiter();

export async function main(event: unknown, context: any) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  // 团队开关：MEMBERS_ENABLED=1 / AUDIT_ENABLED=1 才开启，缺省全关（与原来一致）
  const team = teamConfigFromEnv(process.env);
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

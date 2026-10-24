import cloudbase from "@cloudbase/node-sdk";
import { createHash } from "node:crypto";
import { CloudStore } from "./cloud-store";
import { handle } from "./handler";
import { handleSync, parseSyncEvent, rateLimiter, syncFailure } from "./task-sync";
import { pushAction, pushConfigFromEnv } from "./push";
import { webPushSender } from "./reminder-cloud";

// 单实例内存限流（兜底，主防线是控制台限流）
const syncLimit = rateLimiter();

export async function main(event: unknown, context: any) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  // iPhone 提醒事项同步：HTTP 访问或带 syncKey 的调用只走同步接口，不进入私人账本的其他操作。
  let sync;
  try {
    sync = parseSyncEvent(event);
  } catch (error) {
    // 只透出 SyncError；其他错误统一通用提示，不外泄原始报错。
    return syncFailure(error);
  }
  if (sync)
    return handleSync(() => new CloudStore(app.database()), {
      key: process.env.TASK_SYNC_KEY,
      now: () => new Date().toISOString(),
      hash: async (value: string) => createHash("sha256").update(value).digest("hex"),
      limit: syncLimit,
    }, sync);
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
  );
}

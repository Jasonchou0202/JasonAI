import cloudbase from "@cloudbase/node-sdk";
import { createHash, randomUUID } from "node:crypto";
import { CloudStore } from "./cloud-store";
import { handle } from "./handler";
import { handleSync, parseSyncEvent, SyncError } from "./task-sync";
import { pushAction, pushConfigFromEnv } from "./push";
import { webPushSender } from "./reminder-cloud";

export async function main(event: unknown, context: any) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  // iPhone 提醒事项同步：HTTP 访问或带 syncKey 的调用只走同步接口，不进入私人账本的其他操作。
  let sync;
  try {
    sync = parseSyncEvent(event);
  } catch (error) {
    return { ok: false, code: (error as SyncError).code, error: (error as Error).message };
  }
  if (sync)
    return handleSync(() => new CloudStore(app.database()), {
      key: process.env.TASK_SYNC_KEY,
      now: () => new Date().toISOString(),
      newId: () => randomUUID().replace(/-/g, ""),
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

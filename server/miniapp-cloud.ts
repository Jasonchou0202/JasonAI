/**
 * 云函数 miniapp 的入口（第 1 批）。小程序用 wx.cloud.callFunction({ name: "miniapp" }) 调用。
 * - 身份只取本次调用的平台上下文：openid/appid 来自 parseContext(context).environment（不读 process.env，
 *   避免实例复用残留；不读 event.userInfo 或 payload 里的任何身份字段）；网页 uid 和 sales 一样取 getAuthContext(context)。
 * - 业务调用原样交给 server/handler.ts 的 handle()，权限、数据归属、日志和网页完全一致。
 * - 不需要 AppSecret；不配 HTTP 路由；MINIAPP_ENABLED 缺省关。
 */
import cloudbase from "@cloudbase/node-sdk";
import { createHash, randomBytes } from "node:crypto";
import { CloudStore } from "./cloud-store";
import { handle } from "./handler";
import { appendOnly } from "./audit";
import { teamConfigFromEnv } from "./team";
import type { Store } from "./service";
import { handleMiniapp, miniappConfigFromEnv } from "./miniapp/gate";
import { cloudAvatarStorage, cloudReceiptStorage } from "./miniapp/cloud-storage";
import type { PlatformIdentity } from "./miniapp/source";
import type { MiniStore } from "./miniapp/types";

const sha256 = async (value: string) => createHash("sha256").update(value).digest("hex");

/** 只看本次调用的 context，不合并进程环境变量 */
function wxFromContext(context: any): { openid?: string; appid?: string } {
  try {
    const parsed = cloudbase.parseContext(context);
    const env = (parsed.environment || parsed.environ || {}) as Record<string, unknown>;
    return {
      ...(typeof env.WX_OPENID === "string" && env.WX_OPENID ? { openid: env.WX_OPENID } : {}),
      ...(typeof env.WX_APPID === "string" && env.WX_APPID ? { appid: env.WX_APPID } : {}),
    };
  } catch {
    return {};
  }
}

export async function main(event: unknown, context: any) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  const warn = (code: string) => console.warn("miniapp", code);
  const wx = wxFromContext(context);
  let uid: string | undefined;
  if (!wx.openid) {
    const auth = await app.auth().getAuthContext(context);
    uid = auth.uid || undefined;
  }
  const platform: PlatformIdentity = { ...wx, ...(uid ? { uid } : {}) };
  const team = {
    ...teamConfigFromEnv(process.env),
    avatarStorage: cloudAvatarStorage(app),
    receiptStorage: cloudReceiptStorage(app),
    warn: (code: string) => console.warn("miniapp team", code),
  };
  const ownerUid = process.env.OWNER_UID || "";
  const now = () => new Date().toISOString();
  const store = () => new CloudStore(app.database()) as unknown as MiniStore;
  return handleMiniapp(
    {
      store,
      ownerUid,
      config: miniappConfigFromEnv(process.env),
      team,
      now,
      hash: sha256,
      random: (n) => new Uint8Array(randomBytes(n)),
      business: (bound, e) =>
        handle(
          () => new CloudStore(app.database()),
          { uid: bound, ownerUid, hash: sha256 },
          e,
          (code) => console.warn("miniapp request failed", code),
          undefined,
          team,
        ),
      audit: (note) => appendOnly(store() as unknown as Store, now, warn).append(note),
      diagnose: warn,
    },
    platform,
    event,
  );
}

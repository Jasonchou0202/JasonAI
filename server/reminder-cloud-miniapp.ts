/**
 * reminders 云函数 · 小程序版入口（第 3 批）。
 * 先原样跑原来的提醒（server/reminder-cloud.ts 的 main，一行不改：来源校验、Web Push、健康记录都照旧），
 * 只有 MINIAPP_NOTIFY_ENABLED=1 并且原来的提醒正常跑完，才接着发小程序「服务通知」。
 * 关着时返回值和原来完全一样。构建到 cloudfunctions/reminders-miniapp/，替换线上 reminders 要 Jason 说「上」。
 */
import cloudbase from "@cloudbase/node-sdk";
import { main as baseMain } from "./reminder-cloud";
import { CloudStore } from "./cloud-store";
import { batch3ConfigFromEnv } from "./miniapp/batch3";
import { notifyConfigFromEnv, runMiniappNotify, type WxSender } from "./miniapp/notify";
import type { MiniStore } from "./miniapp/types";

/** 云调用发订阅消息：不需要 AppSecret；函数要在 config.json 里声明 openapi 权限（需真机实测，方案附录 D） */
export function cloudWxSender(app: ReturnType<typeof cloudbase.init>): WxSender {
  return async (msg) => {
    let res: { result?: unknown } | undefined;
    try {
      res = (await app.callWxOpenApi({ apiName: "/cgi-bin/message/subscribe/send", requestData: msg })) as { result?: unknown };
    } catch {
      throw Object.assign(new Error("服务通知未发出"), { errCode: -1 });
    }
    let body: unknown = res?.result;
    try {
      if (typeof body === "string") body = JSON.parse(body);
      else if (body && typeof body === "object" && (body as { type?: string }).type === "Buffer")
        body = JSON.parse(Buffer.from((body as { data: number[] }).data).toString("utf8"));
    } catch {
      body = null;
    }
    const code = Number((body as { errcode?: unknown } | null)?.errcode ?? 0);
    if (code !== 0) throw Object.assign(new Error("服务通知未发出"), { errCode: code });
  };
}

export async function main(event: unknown, context: any = {}): Promise<unknown> {
  const result = await baseMain(event, context);
  const base = batch3ConfigFromEnv(process.env);
  if (!base.notifyEnabled) return result;
  if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok === false) return result;
  try {
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    const store = new CloudStore(app.database()) as unknown as MiniStore;
    const run = await runMiniappNotify(store, notifyConfigFromEnv(process.env, base), cloudWxSender(app), Date.now());
    return { ...result, miniapp: run };
  } catch {
    return { ...result, miniapp: { error: "MINIAPP_NOTIFY_FAILED" } };
  }
}

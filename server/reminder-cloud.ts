import cloudbase from "@cloudbase/node-sdk";
import webpush from "web-push";
import { timingSafeEqual } from "node:crypto";
import { CloudStore } from "./cloud-store";
import { runReminders } from "./reminders";
import {
  pushConfigFromEnv,
  requirePushConfig,
  validatePushSubscription,
  pushFailure,
  REMINDER_HEALTH_ID,
  type ReminderHealth,
  type PushConfig,
  type PushSender,
} from "./push";

/** web-push uses native https.request: a 3xx is rejected, never followed. */
export function webPushSender(config: PushConfig): PushSender {
  return async (subscription, notification) => {
    requirePushConfig(config);
    const validated = validatePushSubscription(subscription);
    try {
      const result = await webpush.sendNotification(
        validated,
        JSON.stringify({
          taskId: notification.taskId,
          tag: notification.tag,
        }),
        {
          vapidDetails: {
            publicKey: config.publicKey,
            privateKey: config.privateKey,
            subject: config.subject,
          },
          timeout: 10_000,
          TTL: 600,
          topic: notification.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(-32),
        },
      );
      if (result.statusCode < 200 || result.statusCode >= 300)
        throw { statusCode: result.statusCode };
      return { statusCode: result.statusCode };
    } catch (error) {
      const failure = pushFailure(error);
      const statusCode =
        error && typeof error === "object" && "statusCode" in error
          ? Number(error.statusCode)
          : undefined;
      // Strip the SDK body, response headers, endpoint and VAPID material.
      throw Object.assign(new Error("推送请求未被接受"), {
        code: failure.code,
        ...(Number.isInteger(statusCode) ? { statusCode } : {}),
      });
    }
  };
}
export function isReminderTimer(event: unknown): boolean {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  const e = event as Record<string, unknown>;
  return e.Type === "Timer" && typeof e.TriggerName === "string" &&
    /^customer-reminders(?:-[a-f0-9]{32})?$/.test(e.TriggerName);
}
function validSecretTimerName(event: unknown): boolean {
  const secret = process.env.REMINDER_TRIGGER_TOKEN || "";
  const name = (event as Record<string, unknown>).TriggerName;
  if (!/^[a-f0-9]{64}$/.test(secret) || typeof name !== "string" ||
      !/^customer-reminders-[a-f0-9]{32}$/.test(name)) return false;
  return timingSafeEqual(Buffer.from(secret.slice(0, 32)), Buffer.from(name.slice(19)));
}
function validTriggerMessage(event: unknown): boolean {
  const secret = process.env.REMINDER_TRIGGER_TOKEN || "";
  const message = (event as Record<string, unknown>).Message;
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret) || typeof message !== "string")
    return false;
  const a = Buffer.from(secret),
    b = Buffer.from(message);
  return a.length === b.length && timingSafeEqual(a, b);
}
/**
 * Only use the current platform context's TRIGGER_SRC, never dynamic process.env:
 * CloudBase can reuse an instance whose process identity/source fields are stale.
 * If source is absent, require a secret timer name or Message (REMINDER_TRIGGER_TOKEN).
 * Deploy as an event function with ONLY a minute timer, no public HTTP binding.
 */
export async function main(
  event: unknown,
  context: any = {},
): Promise<unknown> {
  const started = Date.now();
  if (!isReminderTimer(event)) throw new Error("仅允许指定的提醒定时器执行");
  const privateDiagnostic = validTriggerMessage(event);
  const config = pushConfigFromEnv();
  if (!config.ownerUid) {
    if (privateDiagnostic)
      return { ok: false, error: "REMINDER_AUTH_FAILED", stage: "owner_configuration" };
    throw new Error("提醒后台尚未绑定所有者");
  }
  let app: ReturnType<typeof cloudbase.init>;
  try {
    requirePushConfig(config);
    app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  } catch {
    if (privateDiagnostic)
      return { ok: false, error: "REMINDER_EXECUTION_FAILED", stage: "initialization" };
    throw new Error("推送服务尚未配置完成或提醒后台初始化失败");
  }
  let source: ReminderHealth["source"];
  let authStage = "auth_context";
  try {
    const auth = await app.auth().getAuthContext(context);
    authStage = "parse_context";
    const parsed = cloudbase.parseContext(context);
    const current = (parsed.environment || parsed.environ || {}) as Record<
      string,
      unknown
    >;
    authStage = "identity";
    if (
      (auth.uid && auth.uid !== config.ownerUid) ||
      (current.TCB_UUID && current.TCB_UUID !== config.ownerUid) ||
      String(auth.loginType || "")
        .toLowerCase()
        .includes("anonymous") ||
      [true, "true", "1"].some(
        (value) => value === current.TCB_ISANONYMOUS_USER,
      )
    )
      throw new Error("无权执行后台提醒");
    authStage = "source";
    const secretTimer = validSecretTimerName(event);
    if (current.TRIGGER_SRC !== "timer" && !secretTimer && !privateDiagnostic)
      throw new Error("无法验证提醒定时器来源");
    // A valid Message authorizes execution, but does not prove a real timer fired.
    source = current.TRIGGER_SRC === "timer" || secretTimer ? "timer" : "manual";
  } catch {
    // This includes SDK/parse errors: fail closed, without leaking context fields.
    if (privateDiagnostic)
      return { ok: false, error: "REMINDER_AUTH_FAILED", stage: authStage };
    throw new Error("无权执行后台提醒或无法验证定时器来源");
  }
  const limit = Number(context.time_limit_in_ms);
  const budget =
    Number.isFinite(limit) && limit > 0 ? Math.min(limit, 60_000) : 60_000;
  let store: CloudStore | undefined;
  let executionStage = "database";
  try {
    store = new CloudStore(app.database());
    executionStage = "scan";
    const result = await runReminders(
      store,
      config,
      webPushSender(config),
      () => new Date(),
      { deadlineMs: started + budget - 8_000 },
    );
    // Explicit whitelist: never persist the event, context, identity or push material.
    executionStage = "health_write";
    await store.put<ReminderHealth>("batches", REMINDER_HEALTH_ID, {
      lastRunAt: new Date().toISOString(),
      source,
      accepted: result.accepted,
      failed: result.failed,
      cancelled: result.cancelled,
      retried: result.retried,
      unsubscribed: result.unsubscribed,
      attempted: result.attempted,
      deferred: result.deferred,
    });
    return result;
  } catch {
    // Reached only after identity/source verification. Persistence is best effort:
    // even a database outage must leave a readable, generic invocation result.
    try {
      const healthStore = store ?? new CloudStore(app.database());
      await healthStore.put<ReminderHealth>("batches", REMINDER_HEALTH_ID, {
        lastRunAt: new Date().toISOString(),
        source,
        error: "REMINDER_EXECUTION_FAILED",
      });
    } catch { /* Never leak SDK errors or hide the safe response behind another throw. */ }
    return { ok: false, error: "REMINDER_EXECUTION_FAILED", stage: executionStage };
  }
}

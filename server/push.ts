import { createHash, createECDH, ECDH } from "node:crypto";
import { identity, type Context, type Store } from "./service";

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
  /** Fixed timer owner, supplied by the cloud entry point (never by a client). */
  ownerUid?: string;
}
export const REMINDER_HEALTH_ID = "_reminder_health";
export type ReminderHealth = {
  lastRunAt: string;
  source: "timer" | "manual";
} & ({
  accepted: number;
  failed: number;
  cancelled: number;
  retried: number;
  unsubscribed: number;
  attempted: number;
  deferred: number;
  error?: never;
} | { error: "REMINDER_EXECUTION_FAILED" });
export interface PushSubscription {
  id: string;
  uid: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
  updatedAt: string;
  active: boolean;
  lastError?: string;
  lastAcceptedAt?: string;
}
/** The service worker supplies generic copy and derives the calendar URL. */
export interface PushNotification {
  taskId: string;
  tag: string;
}
export type PushSender = (
  subscription: PushSubscription,
  notification: PushNotification,
) => Promise<unknown>;

export function pushConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PushConfig {
  return {
    publicKey: env.VAPID_PUBLIC_KEY || "",
    privateKey: env.VAPID_PRIVATE_KEY || "",
    subject: env.VAPID_SUBJECT || "",
    ownerUid: env.OWNER_UID || "",
  };
}
function base64Key(value: unknown, bytes: number): Buffer {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length !== Math.ceil((bytes * 4) / 3)
  )
    throw new Error("推送密钥格式无效");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== bytes || decoded.toString("base64url") !== value)
    throw new Error("推送密钥格式无效");
  return decoded;
}
function publicKey(value: unknown): Buffer {
  const bytes = base64Key(value, 65);
  try {
    if (bytes[0] !== 4) throw new Error();
    ECDH.convertKey(bytes, "prime256v1", undefined, undefined, "uncompressed");
  } catch {
    throw new Error("推送密钥格式无效");
  }
  return bytes;
}
export function pushConfigured(config: PushConfig): boolean {
  try {
    const pub = publicKey(config.publicKey),
      priv = base64Key(config.privateKey, 32);
    const key = createECDH("prime256v1");
    key.setPrivateKey(priv);
    if (!key.getPublicKey().equals(pub)) return false;
    const subject = new URL(config.subject);
    return (
      (subject.protocol === "https:" &&
        !!subject.hostname &&
        !subject.username &&
        !subject.password) ||
      (subject.protocol === "mailto:" &&
        /^[^\s@]+@[^\s@]+$/.test(subject.pathname))
    );
  } catch {
    return false;
  }
}
export function requirePushConfig(config: PushConfig): void {
  if (!pushConfigured(config)) throw new Error("推送服务尚未配置完成");
}
export function validatePushEndpoint(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !/^https:\/\//.test(value) ||
    /[\s\\]/.test(value)
  )
    throw new Error("推送地址无效");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("推送地址无效");
  }
  const host = url.hostname;
  const allowed =
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+notify\.windows\.com$/.test(host) ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+push\.apple\.com$/.test(host);
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.hash ||
    !allowed
  )
    throw new Error("推送地址无效");
  return url.href;
}
export function validatePushSubscription(
  value: unknown,
): Pick<PushSubscription, "endpoint" | "keys"> {
  const s = object(value),
    keys = object(s.keys);
  const endpoint = validatePushEndpoint(s.endpoint);
  publicKey(keys.p256dh);
  base64Key(keys.auth, 16);
  return {
    endpoint,
    keys: { p256dh: keys.p256dh as string, auth: keys.auth as string },
  };
}
export function subscriptionId(uid: string, endpoint: string): string {
  return createHash("sha256")
    .update(JSON.stringify([uid, endpoint]))
    .digest("hex");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("请求格式无效");
  return value as Record<string, unknown>;
}
function deviceId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("推送设备编号无效");
  return value;
}
export interface PushFailure {
  code: string;
  retryable: boolean;
  unsubscribe: boolean;
}
/** Only controlled codes reach storage/API; provider bodies and headers are discarded. */
export function pushFailure(error: unknown): PushFailure {
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? Number(error.statusCode)
      : 0;
  if (status === 404 || status === 410)
    return {
      code: "subscription_expired",
      retryable: false,
      unsubscribe: true,
    };
  if (status === 403)
    return { code: "push_forbidden", retryable: false, unsubscribe: false };
  if (status === 429)
    return { code: "push_rate_limited", retryable: true, unsubscribe: false };
  if (status >= 500 && status <= 599)
    return { code: "push_unavailable", retryable: true, unsubscribe: false };
  if (!status)
    return { code: "push_network_error", retryable: true, unsubscribe: false };
  return { code: "push_rejected", retryable: false, unsubscribe: false };
}
export async function sendPush(
  send: PushSender,
  subscription: PushSubscription,
  notification: PushNotification,
): Promise<PushFailure | null> {
  try {
    // Validate again at the send boundary, including records restored from storage.
    validatePushSubscription(subscription);
  } catch {
    return {
      code: "subscription_invalid",
      retryable: false,
      unsubscribe: true,
    };
  }
  try {
    const result = await send(subscription, notification);
    if (result && typeof result === "object" && "statusCode" in result) {
      const status = Number(result.statusCode);
      if (!Number.isInteger(status) || status < 200 || status >= 300)
        return pushFailure(result);
    }
    return null;
  } catch (error) {
    return pushFailure(error);
  }
}
export function sameSubscription(
  a: PushSubscription,
  b: PushSubscription,
): boolean {
  return (
    a.uid === b.uid &&
    a.updatedAt === b.updatedAt &&
    a.endpoint === b.endpoint &&
    a.keys.p256dh === b.keys.p256dh &&
    a.keys.auth === b.keys.auth
  );
}
export function subscriptionOutcome(
  s: PushSubscription,
  failure: PushFailure | null,
  time: string,
): PushSubscription {
  const { lastError: _lastError, ...clean } = s;
  return failure
    ? {
        ...s,
        active: failure.unsubscribe ? false : s.active,
        lastError: failure.code,
      }
    : { ...clean, lastAcceptedAt: time };
}
interface TestAttempt {
  id: string;
  uid: string;
  subscriptionId: string;
  state: "sending" | "accepted" | "failed" | "cancelled";
  startedAt: string;
  lastError?: string;
}

export async function pushAction(
  store: Store,
  ctx: Context,
  action: string,
  payload: unknown,
  config: PushConfig,
  send: PushSender,
): Promise<unknown> {
  identity(ctx);
  const p = object(payload ?? {}),
    uid = ctx.uid!;
  const now = () => ctx.now?.() || new Date().toISOString();
  if (action === "push.config")
    return { publicKey: config.publicKey, configured: pushConfigured(config) };
  if (action === "push.subscribe") {
    requirePushConfig(config);
    const subscription = validatePushSubscription(p.subscription),
      id = subscriptionId(uid, subscription.endpoint);
    await store.transaction(async (tx) => {
      const old = await tx.get<PushSubscription>("subscriptions", id),
        time = now();
      if (old && old.uid !== uid) throw new Error("无权操作这个推送设备");
      // Distinguish renewals even within the same millisecond from an in-flight send.
      const updatedAt = old
        ? new Date(
            Math.max(Date.parse(time), Date.parse(old.updatedAt) + 1),
          ).toISOString()
        : time;
      await tx.put<PushSubscription>("subscriptions", id, {
        ...subscription,
        id,
        uid,
        createdAt: old?.createdAt || time,
        updatedAt,
        active: true,
        ...(old?.lastAcceptedAt ? { lastAcceptedAt: old.lastAcceptedAt } : {}),
      });
    });
    return { id };
  }
  if (action === "push.status") {
    const configured = pushConfigured(config);
    const s = p.id === undefined ? null : await store.get<PushSubscription>(
      "subscriptions", deviceId(p.id),
    );
    if (s && s.uid !== uid) throw new Error("无权操作这个推送设备");
    const health = await store.get<ReminderHealth>("batches", REMINDER_HEALTH_ID);
    const validHealth = health &&
      (health.source === "timer" || health.source === "manual") &&
      typeof health.lastRunAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(health.lastRunAt) &&
      Number.isFinite(Date.parse(health.lastRunAt));
    return {
      configured,
      active: s?.active === true,
      ...(validHealth ? {
        schedulerLastRunAt: health.lastRunAt,
        schedulerSource: health.source,
        ...(health.error === "REMINDER_EXECUTION_FAILED"
          ? { schedulerError: health.error } : {}),
      } : {}),
      ...(s?.lastError ? { lastError: s.lastError } : {}),
      ...(s?.lastAcceptedAt ? { lastAcceptedAt: s.lastAcceptedAt } : {}),
    };
  }
  if (action === "push.unsubscribe") {
    const id = deviceId(p.id);
    await store.transaction(async (tx) => {
      const s = await tx.get<PushSubscription>("subscriptions", id);
      if (s && s.uid !== uid) throw new Error("无权操作这个推送设备");
      if (s)
        await tx.put("subscriptions", id, {
          ...s,
          active: false,
          updatedAt: now(),
        });
    });
    return { active: false };
  }
  if (action !== "push.test") throw new Error("不支持的推送操作");
  requirePushConfig(config);
  const id = deviceId(p.id),
    attemptId = "test_" + id;
  const claim = await store.transaction(async (tx) => {
    const s = await tx.get<PushSubscription>("subscriptions", id);
    const old = await tx.get<TestAttempt>("deliveries", attemptId);
    if (!s || s.uid !== uid) throw new Error("无权操作这个推送设备");
    if (!s.active) throw new Error("当前设备尚未启用推送");
    const time = now();
    if (old && Date.parse(time) - Date.parse(old.startedAt) < 30_000)
      throw new Error("测试提醒请间隔至少30秒");
    await tx.put<TestAttempt>("deliveries", attemptId, {
      id: attemptId,
      uid,
      subscriptionId: id,
      state: "sending",
      startedAt: time,
    });
    return { s, time };
  });
  // A separate read catches an unsubscribe between claim and network send.
  const current = await store.get<PushSubscription>("subscriptions", id);
  const failure =
    !current?.active || !sameSubscription(current, claim.s)
      ? { code: "subscription_changed", retryable: false, unsubscribe: false }
      : await sendPush(send, claim.s, { taskId: "", tag: "teststable" });
  await store.transaction(async (tx) => {
    const attempt = await tx.get<TestAttempt>("deliveries", attemptId);
    const s = await tx.get<PushSubscription>("subscriptions", id);
    if (attempt?.startedAt !== claim.time) return;
    await tx.put("deliveries", attemptId, {
      ...attempt,
      state: failure ? "failed" : "accepted",
      ...(failure ? { lastError: failure.code } : {}),
    });
    if (s && sameSubscription(s, claim.s))
      await tx.put("subscriptions", id, subscriptionOutcome(s, failure, now()));
  });
  if (failure) throw new Error("测试推送未被接受，请查看当前设备状态");
  return { accepted: true };
}

import { createHash, randomUUID } from "node:crypto";
import type { CustomerTask } from "../src/domain/model";
import type { Store, Transaction } from "./service";
import {
  pushConfigured,
  sendPush,
  sameSubscription,
  subscriptionOutcome,
  type PushConfig,
  type PushSender,
  type PushSubscription,
} from "./push";

export const REMINDER_ADVANCE_MS = 15 * 60_000;
export const REMINDER_WINDOW_MS = 10 * 60_000;
export const REMINDER_RETRY_MS = 2 * 60_000;
export const REMINDER_LEASE_MS = 60_000;
export const REMINDER_MAX_ATTEMPTS = 3;
export const REMINDER_MAX_SENDS = 20;
export const REMINDER_CONCURRENCY = 4;
export type ReminderState =
  "leased" | "retry" | "accepted" | "failed" | "cancelled" | "unsubscribed";
export interface ReminderDelivery {
  id: string;
  uid: string;
  taskId: string;
  generation: string;
  offset: number;
  subscriptionId: string;
  scheduledAt: string;
  tag: string;
  state: ReminderState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  leaseToken?: string;
  leaseUntil?: string;
  nextAttemptAt?: string;
  lastError?: string;
  acceptedAt?: string;
}
export interface ReminderRun {
  configured: boolean;
  paused: boolean;
  accepted: number;
  failed: number;
  cancelled: number;
  retried: number;
  unsubscribed: number;
  attempted: number;
  deferred: number;
}
export interface ReminderRunOptions {
  /** Absolute wall-clock deadline; reserve network/finalization time before claiming. */
  deadlineMs?: number;
}
export type ReminderNow =
  string | number | Date | (() => string | number | Date);
function instant(value: string | number | Date): number {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("提醒扫描时间无效");
  return ms;
}
function stamp(ms: number): string {
  return new Date(ms).toISOString();
}
const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function reminderDeliveryId(
  taskId: string,
  generation: string,
  offset: number,
  subscriptionId: string,
): string {
  return sha([taskId, generation, offset, subscriptionId]);
}
function pending(d: ReminderDelivery): boolean {
  return d.state === "leased" || d.state === "retry";
}
async function restoring(tx: Transaction): Promise<boolean> {
  return Boolean(
    (await tx.get<{ restoreId?: string | null }>("batches", "_ledger"))
      ?.restoreId,
  );
}
function invalid(
  task: CustomerTask | null,
  sub: PushSubscription | null,
  d: ReminderDelivery,
  now: number,
): string | null {
  if (!task || task.deletedAt || task.completedAt || task.reminder === "off")
    return "task_cancelled";
  if (
    task.reminderGeneration !== d.generation ||
    (d.offset !== 0 && task.reminder !== "both")
  )
    return "task_changed";
  const at = Date.parse(task.at),
    start = Date.parse(task.reminderStartAt),
    scheduled = Date.parse(d.scheduledAt);
  if (
    !Number.isFinite(at) ||
    !Number.isFinite(start) ||
    !task.reminderGeneration ||
    scheduled !== at + d.offset ||
    scheduled <= start
  )
    return "task_changed";
  if (now >= scheduled + REMINDER_WINDOW_MS || now >= at + REMINDER_WINDOW_MS)
    return "reminder_expired";
  if (!sub || !sub.active || sub.uid !== d.uid) return "subscription_inactive";
  return null;
}
async function cancel(
  tx: Transaction,
  d: ReminderDelivery,
  reason: string,
  now: number,
): Promise<ReminderDelivery> {
  const next: ReminderDelivery = {
    ...d,
    state: "cancelled",
    lastError: reason,
    updatedAt: stamp(now),
  };
  await tx.put("deliveries", d.id, next);
  return next;
}

/** One tick; network I/O is outside transaction callbacks, which the SDK may replay. */
export async function runReminders(
  store: Store,
  config: PushConfig,
  send: PushSender,
  now: ReminderNow = new Date(),
  options: ReminderRunOptions = {},
): Promise<ReminderRun> {
  const clock = () => instant(typeof now === "function" ? now() : now);
  const deadline = options.deadlineMs ?? Date.now() + 52_000;
  const enoughTime = () => Date.now() + 12_000 < deadline;
  const result: ReminderRun = {
    configured: pushConfigured(config),
    paused: false,
    accepted: 0,
    failed: 0,
    cancelled: 0,
    retried: 0,
    unsubscribed: 0,
    attempted: 0,
    deferred: 0,
  };
  if (!result.configured) return result;
  const uid = config.ownerUid || process.env.OWNER_UID || "";
  if (!uid) throw new Error("提醒后台尚未绑定所有者");
  clock();
  if (await restoring(store)) return { ...result, paused: true };
  const [tasks, subscriptions, deliveries] = await Promise.all([
    store.list<CustomerTask>("tasks"),
    store.list<PushSubscription>("subscriptions"),
    store.list<ReminderDelivery>("deliveries"),
  ]);
  const jobs = new Map<string, ReminderDelivery>();
  // Pending rows must be settled even when a task no longer appears in the active scan.
  for (const d of deliveries)
    if (d.uid === uid && d.taskId && pending(d)) jobs.set(d.id, d);
  const seen = new Set(deliveries.map((d) => d.id));
  for (const task of tasks) {
    if (
      task.deletedAt ||
      task.completedAt ||
      !["both", "due"].includes(task.reminder) ||
      typeof task.reminderGeneration !== "string" ||
      !task.reminderGeneration
    )
      continue;
    const at = Date.parse(task.at),
      start = Date.parse(task.reminderStartAt),
      time = clock();
    if (
      !Number.isFinite(at) ||
      !Number.isFinite(start) ||
      time >= at + REMINDER_WINDOW_MS
    )
      continue;
    for (const offset of task.reminder === "both"
      ? [-REMINDER_ADVANCE_MS, 0]
      : [0]) {
      const scheduled = at + offset;
      if (
        scheduled <= start ||
        scheduled > time ||
        time >= scheduled + REMINDER_WINDOW_MS
      )
        continue;
      for (const sub of subscriptions) {
        if (!sub.active || sub.uid !== uid) continue;
        const id = reminderDeliveryId(
          task.id,
          task.reminderGeneration,
          offset,
          sub.id,
        );
        if (seen.has(id)) continue;
        jobs.set(id, {
          id,
          uid,
          taskId: task.id,
          generation: task.reminderGeneration,
          offset,
          subscriptionId: sub.id,
          scheduledAt: stamp(scheduled),
          tag:
            "reminder_" +
            sha([task.id, task.reminderGeneration, offset]).slice(0, 32),
          state: "retry",
          attempts: 0,
          createdAt: stamp(time),
          updatedAt: stamp(time),
        });
      }
    }
  }
  async function processSeed(seed: ReminderDelivery): Promise<boolean> {
    const claim = await store.transaction(async (tx) => {
      if (await restoring(tx)) return { paused: true } as const;
      const existing = await tx.get<ReminderDelivery>("deliveries", seed.id);
      const task = await tx.get<CustomerTask>("tasks", seed.taskId);
      const sub = await tx.get<PushSubscription>(
        "subscriptions",
        seed.subscriptionId,
      );
      const d = existing || seed,
        time = clock();
      if (d.uid !== uid || !pending(d)) return null;
      const reason = invalid(task, sub, d, time);
      if (reason) {
        if (existing) await cancel(tx, d, reason, time);
        return existing ? ({ cancelled: true } as const) : null;
      }
      if (
        time < Date.parse(d.scheduledAt) ||
        (d.leaseUntil && time < Date.parse(d.leaseUntil)) ||
        (d.nextAttemptAt && time < Date.parse(d.nextAttemptAt))
      )
        return null;
      if (d.attempts >= REMINDER_MAX_ATTEMPTS) {
        await tx.put("deliveries", d.id, {
          ...d,
          state: "failed",
          lastError: "retry_exhausted",
          updatedAt: stamp(time),
        });
        return { failed: true } as const;
      }
      const leased: ReminderDelivery = {
        ...d,
        state: "leased",
        attempts: d.attempts + 1,
        leaseToken: randomUUID(),
        leaseUntil: stamp(time + REMINDER_LEASE_MS),
        nextAttemptAt: stamp(time + REMINDER_RETRY_MS),
        updatedAt: stamp(time),
      };
      await tx.put("deliveries", d.id, leased);
      return { leased, sub: sub! };
    });
    if (!claim) return false;
    if ("paused" in claim) {
      result.paused = true;
      return false;
    }
    if ("cancelled" in claim) {
      result.cancelled++;
      return false;
    }
    if ("failed" in claim) {
      result.failed++;
      return false;
    }
    const { leased, sub } = claim;
    // Final state check immediately before send. A restore or mutation can occur after the scan/lease.
    const ready = await store.transaction(async (tx) => {
      const pause = await restoring(tx);
      const d = await tx.get<ReminderDelivery>("deliveries", leased.id);
      const task = await tx.get<CustomerTask>("tasks", leased.taskId);
      const current = await tx.get<PushSubscription>("subscriptions", sub.id);
      const time = clock();
      if (!d || !pending(d) || d.leaseToken !== leased.leaseToken)
        return "skip";
      if (pause || !enoughTime()) {
        await tx.put("deliveries", d.id, {
          ...d,
          state: "retry",
          attempts: d.attempts - 1,
          leaseUntil: stamp(time),
          nextAttemptAt: stamp(time),
          updatedAt: stamp(time),
        });
        return pause ? "paused" : "budget";
      }
      const reason =
        invalid(task, current, d, time) ||
        (current && !sameSubscription(current, sub)
          ? "subscription_changed"
          : null);
      if (reason) {
        await cancel(tx, d, reason, time);
        return "cancelled";
      }
      if (!d.leaseUntil || time >= Date.parse(d.leaseUntil)) return "skip";
      return "ready";
    });
    if (ready === "paused") {
      result.paused = true;
      return false;
    }
    if (ready === "cancelled") {
      result.cancelled++;
      return false;
    }
    if (ready !== "ready") return false;
    result.attempted++;
    const failure = await sendPush(send, sub, {
      taskId: leased.taskId,
      tag: leased.tag,
    });
    const state = await store.transaction(async (tx) => {
      const d = await tx.get<ReminderDelivery>("deliveries", leased.id);
      const current = await tx.get<PushSubscription>("subscriptions", sub.id);
      if (!d || d.state !== "leased" || d.leaseToken !== leased.leaseToken)
        return null;
      const time = clock();
      const state: ReminderState = !failure
        ? "accepted"
        : failure.unsubscribe
          ? "unsubscribed"
          : failure.retryable &&
              d.attempts < REMINDER_MAX_ATTEMPTS &&
              time + REMINDER_RETRY_MS <
                Date.parse(d.scheduledAt) + REMINDER_WINDOW_MS
            ? "retry"
            : "failed";
      const {
        lastError: _lastError,
        leaseToken: _leaseToken,
        leaseUntil: _leaseUntil,
        nextAttemptAt: _nextAttempt,
        ...clean
      } = d;
      await tx.put<ReminderDelivery>("deliveries", d.id, {
        ...clean,
        state,
        updatedAt: stamp(time),
        ...(failure
          ? { lastError: failure.code }
          : { acceptedAt: stamp(time) }),
        ...(state === "retry"
          ? { nextAttemptAt: stamp(time + REMINDER_RETRY_MS) }
          : {}),
      });
      if (current && sameSubscription(current, sub))
        await tx.put(
          "subscriptions",
          sub.id,
          subscriptionOutcome(current, failure, stamp(time)),
        );
      return state;
    });
    if (state === "accepted") result.accepted++;
    if (state === "failed") result.failed++;
    if (state === "retry") result.retried++;
    if (state === "unsubscribed") result.unsubscribed++;
    return true;
  }
  const seeds = [...jobs.values()].sort(
    (a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id),
  );
  let index = 0,
    allocated = 0,
    stopped = false;
  const worker = async () => {
    while (
      index < seeds.length &&
      !result.paused &&
      !stopped &&
      allocated < REMINDER_MAX_SENDS &&
      enoughTime()
    ) {
      const seed = seeds[index++];
      // Reserve synchronously before awaiting: sent + in-flight can never exceed 20.
      allocated++;
      try {
        if (!(await processSeed(seed))) allocated--;
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  const workers = await Promise.allSettled(
    Array.from({ length: REMINDER_CONCURRENCY }, worker),
  );
  const failure = workers.find((r) => r.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  result.deferred = seeds.length - index;
  return result;
}

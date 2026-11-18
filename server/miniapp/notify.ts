/**
 * 小程序「微信服务通知」（订阅消息）发送逻辑 · 第 3 批（方案第 5 节第 5 条、第 6 节第 5 条）。
 * 由 reminders 的小程序版入口（server/reminder-cloud-miniapp.ts）在原有提醒跑完之后调用；
 * MINIAPP_NOTIFY_ENABLED 缺省关，关着时一行都不执行。
 * - 日程提醒：和网页推送同一套到点规则（提前 15 分钟 / 到点，10 分钟窗口），发给日程归属人（没有归属按建的人 → 管理员）。
 * - 新申请：有新的待批申请时，给管理员发一条。
 * - 一次性订阅：同意一次只能发一条，先扣额度、记去重键，再发；对方拒收（43101）就把额度清零。
 * - openid 只在这里读出来交给微信，不写日志、不回任何调用方。
 */
import { createHash } from "node:crypto";
import type { CustomerTask } from "../../src/domain/model";
import type { Member } from "../team";
import { REMINDER_ADVANCE_MS, REMINDER_WINDOW_MS } from "../reminders";
import type { Application, Binding, MiniStore } from "./types";
import type { Batch3Config, MiniSub, SubKind } from "./batch3";

export interface NotifyConfig extends Batch3Config {
  ownerUid: string;
  /** 模板字段名（只是名字，比如 thing1,time2,thing3），按 [事项, 时间, 备注] 的顺序 */
  keys: Partial<Record<SubKind, string[]>>;
  /** 体验版用 trial（缺省），正式版 formal */
  state: "trial" | "formal" | "developer";
  page: string;
}
export function notifyConfigFromEnv(env: Record<string, string | undefined>, base: Batch3Config): NotifyConfig {
  const keys = (v?: string) => {
    const list = (v || "").split(",").map((x) => x.trim()).filter(Boolean);
    return list.length >= 2 && list.length <= 5 && list.every((k) => /^[a-z_]+\d{1,2}$/.test(k)) ? list : undefined;
  };
  const task = keys(env.MINIAPP_TPL_TASK_KEYS);
  const apply = keys(env.MINIAPP_TPL_APPLY_KEYS);
  const state = env.MINIAPP_STATE === "formal" || env.MINIAPP_STATE === "developer" ? env.MINIAPP_STATE : "trial";
  return {
    ...base,
    ownerUid: env.OWNER_UID || "",
    keys: { ...(task ? { task } : {}), ...(apply ? { apply } : {}) },
    state,
    page: "pages/gate/index",
  };
}

export interface WxMessage {
  touser: string;
  template_id: string;
  page: string;
  miniprogram_state: NotifyConfig["state"];
  lang: "zh_CN";
  data: Record<string, { value: string }>;
}
/** 发送失败时抛出带 errCode 的错误（微信 errcode） */
export type WxSender = (msg: WxMessage) => Promise<void>;
export interface NotifyRun {
  enabled: boolean;
  sent: number;
  failed: number;
  refused: number;
  skipped: number;
}
export const NOTIFY_MAX_SENDS = 20;
const SENT_KEEP = 200;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 24);

/** 订阅消息字段值规则：thing ≤20 字，time/date 用北京时间 */
function fieldValue(key: string, value: string) {
  if (key.startsWith("thing")) return value.length > 20 ? value.slice(0, 19) + "…" : value || "—";
  if (key.startsWith("number")) return value.replace(/[^\d.]/g, "").slice(0, 32) || "0";
  return value.slice(0, 32);
}
export function bjTime(ms: number) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(ms))
    .replace("T", " ");
}
function data(keys: string[], values: string[]) {
  return Object.fromEntries(keys.map((k, i) => [k, { value: fieldValue(k, values[i] ?? "") }]));
}

interface Job {
  subId: string;
  kind: SubKind;
  dedupe: string;
  values: string[];
  /** 新申请：发完记下最新申请时间 */
  applyAt?: string;
}

export async function runMiniappNotify(store: MiniStore, cfg: NotifyConfig, send: WxSender, nowMs: number): Promise<NotifyRun> {
  const out: NotifyRun = { enabled: cfg.notifyEnabled, sent: 0, failed: 0, refused: 0, skipped: 0 };
  if (!cfg.notifyEnabled || !cfg.ownerUid) return out;
  const ledger = await store.get<{ restoreId?: string | null }>("batches", "_ledger");
  if (ledger?.restoreId) return out;
  const subs = (await store.list<MiniSub>("miniapp_subs")).filter((s) => s && s.openid && s.uid);
  if (!subs.length) return out;
  const [bindings, members] = await Promise.all([store.list<Binding>("miniapp_bindings"), store.list<Member>("members")]);
  const live = (s: MiniSub) => {
    const b = bindings.find((x) => x.id === s.id);
    if (!b || b.status !== "active" || b.uid !== s.uid) return false;
    if (s.uid === cfg.ownerUid) return b.kind === "owner";
    const m = members.find((x) => x.uid === s.uid);
    return b.kind === "member" && m?.status === "active";
  };
  const ready = subs.filter(live);
  const jobs: Job[] = [];

  if (cfg.templates.task && cfg.keys.task) {
    const tasks = await store.list<CustomerTask>("tasks");
    for (const task of tasks) {
      if (task.deletedAt || task.completedAt || !["both", "due"].includes(task.reminder) || !task.reminderGeneration) continue;
      const at = Date.parse(task.at),
        start = Date.parse(task.reminderStartAt);
      if (!Number.isFinite(at) || !Number.isFinite(start)) continue;
      const to = task.ownerUid || task.createdBy || cfg.ownerUid;
      for (const offset of task.reminder === "both" ? [-REMINDER_ADVANCE_MS, 0] : [0]) {
        const scheduled = at + offset;
        if (scheduled <= start || scheduled > nowMs || nowMs >= scheduled + REMINDER_WINDOW_MS || nowMs >= at + REMINDER_WINDOW_MS) continue;
        const dedupe = "t" + sha([task.id, task.reminderGeneration, offset]);
        for (const s of ready)
          if (s.uid === to && (s.quota.task ?? 0) > 0 && !(s.sent ?? []).includes(dedupe))
            jobs.push({ subId: s.id, kind: "task", dedupe, values: [task.title, bjTime(at), offset ? "15 分钟后开始" : "现在开始"] });
      }
    }
  }
  if (cfg.templates.apply && cfg.keys.apply) {
    const pending = (await store.list<Application>("miniapp_applications")).filter((a) => a.status === "pending");
    const newest = pending.map((a) => a.lastAppliedAt).sort().pop();
    if (newest)
      for (const s of ready)
        if (s.uid === cfg.ownerUid && (s.quota.apply ?? 0) > 0 && (!s.applyNotifiedAt || s.applyNotifiedAt < newest))
          jobs.push({ subId: s.id, kind: "apply", dedupe: "a" + sha([newest]), values: ["小程序新申请", bjTime(Date.parse(newest)), `待批 ${pending.length} 人`], applyAt: newest });
  }

  for (const job of jobs) {
    if (out.sent + out.failed >= NOTIFY_MAX_SENDS) {
      out.skipped++;
      continue;
    }
    // 先扣额度、记去重键（事务里再查一遍），再发；不会重复发
    const claimed = await store.transaction(async (tx) => {
      const s = await tx.get<MiniSub>("miniapp_subs", job.subId);
      if (!s || (s.quota[job.kind] ?? 0) <= 0 || (s.sent ?? []).includes(job.dedupe)) return null;
      if (job.applyAt && s.applyNotifiedAt && s.applyNotifiedAt >= job.applyAt) return null;
      const next: MiniSub = {
        ...s,
        quota: { ...s.quota, [job.kind]: (s.quota[job.kind] ?? 0) - 1 },
        sent: [...(s.sent ?? []), job.dedupe].slice(-SENT_KEEP),
        ...(job.applyAt ? { applyNotifiedAt: job.applyAt } : {}),
        updatedAt: new Date(nowMs).toISOString(),
      };
      await tx.put("miniapp_subs", s.id, next);
      return s;
    });
    if (!claimed) {
      out.skipped++;
      continue;
    }
    try {
      await send({
        touser: claimed.openid,
        template_id: cfg.templates[job.kind]!,
        page: cfg.page,
        miniprogram_state: cfg.state,
        lang: "zh_CN",
        data: data(cfg.keys[job.kind]!, job.values),
      });
      out.sent++;
    } catch (error) {
      const code = error && typeof error === "object" && "errCode" in error ? Number((error as { errCode: unknown }).errCode) : 0;
      if (code === 43101) {
        // 对方没有可用的订阅次数：额度清零，等他在小程序里再点一次
        out.refused++;
        await store
          .transaction(async (tx) => {
            const s = await tx.get<MiniSub>("miniapp_subs", job.subId);
            if (s) await tx.put("miniapp_subs", s.id, { ...s, quota: { ...s.quota, [job.kind]: 0 } });
          })
          .catch(() => undefined);
      } else out.failed++;
    }
  }
  return out;
}

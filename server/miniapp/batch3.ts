/**
 * miniapp 云函数 · 第 3 批扩展（新文件，门卫 gate.ts 只加一处挂钩）。
 * - 账本设置：导入 Excel（预检 / 分批提交）、完整备份、从备份恢复到空账本。业务仍交给原来的 handle()，
 *   这里只做小程序特有的「大数据搬运」：请求超过 100KB 走 wx.cloud.CDN，回包超过 1MB 用 gzip。
 * - 内容生产：今日获客录入交给同一套 content 逻辑（content 函数本身不动）；内容看板只读版来自随包的 dashboard.json。
 * - 订阅消息：miniapp.subscribe.config / miniapp.subscribe.record，额度记在 miniapp_subs；openid 只存库，永不返回前端。
 * 全部只给已绑定的人；账本设置和内容只给管理员（和网页一致）。
 */
import { gunzipSync, gzipSync } from "node:zlib";
import type { MiniStore } from "./types";

export const B3_LIMITS = {
  /** 回包上限 1MB，留出余量 */
  replyMaxBytes: 900 * 1024,
  /** 和网页一致：表格 10MB 以内、备份 20MB 以内（这里是解析后的 JSON 文本） */
  importMaxBytes: 10 * 1024 * 1024,
  backupMaxBytes: 20 * 1024 * 1024,
  /** 每种订阅最多累计多少次（微信一次性订阅：同意一次发一条） */
  quotaMax: 50,
  fetchTimeoutMs: 15_000,
} as const;

export const SUB_KINDS = ["task", "apply"] as const;
export type SubKind = (typeof SUB_KINDS)[number];

/** miniapp_subs 里的一条：_id = 绑定编号（哈希）；openid 只给 reminders 发服务通知用 */
export interface MiniSub {
  id: string;
  uid: string;
  kind: "owner" | "member";
  openid: string;
  quota: Record<SubKind, number>;
  updatedAt: string;
  /** reminders 已发过的去重键（只留最近 200 条） */
  sent?: string[];
  /** 最近一次给管理员发「新申请」通知时的申请时间 */
  applyNotifiedAt?: string | null;
}

export interface Batch3Config {
  /** MINIAPP_NOTIFY_ENABLED：缺省关 */
  notifyEnabled: boolean;
  /** 订阅消息模板 ID（不是密钥）：MINIAPP_TPL_TASK / MINIAPP_TPL_APPLY */
  templates: Partial<Record<SubKind, string>>;
}
/** 公众平台已选用的「待办事项提醒」模板（不是密钥）；环境变量可覆盖 */
export const DEFAULT_TASK_TEMPLATE = "wsMYvp0ssfye_srTUreOx8zJy1SQqFlF20ZIGOVKC7o";
/** 与模板字段一致：提醒内容、到期日期、备注 */
export const DEFAULT_TASK_KEYS = ["thing2", "time3", "thing4"];

export function batch3ConfigFromEnv(env: Record<string, string | undefined>): Batch3Config {
  const tpl = (v?: string) => (v && /^[\w-]{10,128}$/.test(v) ? v : undefined);
  const task = tpl(env.MINIAPP_TPL_TASK) ?? DEFAULT_TASK_TEMPLATE;
  const apply = tpl(env.MINIAPP_TPL_APPLY);
  return {
    notifyEnabled: env.MINIAPP_NOTIFY_ENABLED === "1",
    templates: { ...(task ? { task } : {}), ...(apply ? { apply } : {}) },
  };
}

export interface B3Who {
  role: "owner" | "member" | "none";
  uid: string;
  /** 小程序来源才有 */
  openid?: string;
  bindId?: string;
}
export interface Batch3Deps {
  config: Batch3Config;
  now: () => string;
  /** 原来的 handle()，回 { ok, data } 或 { ok:false, code, error } */
  business: (uid: string, event: { action: string; payload: unknown }) => Promise<unknown>;
  /** 同一套 content 逻辑（handleContent），回 { ok, data } 或 { ok:false, ... } */
  content?: (uid: string, event: { action: string; payload: unknown }) => Promise<unknown>;
  /** 内容看板只读数据 */
  board?: () => unknown;
  /** 取 wx.cloud.CDN 临时地址的内容（只在云端用） */
  fetchText?: (url: string, maxBytes: number) => Promise<string>;
}

export class B3Error extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
const deny = (code: string, message: string) => new B3Error(code, message);

/** 小程序里能用的内容调用：只有录入相关（导出、备份留在网页） */
export const CONTENT_MINI_ACTIONS = new Set([
  "content.daily.list",
  "content.daily.get",
  "content.daily.save",
  "content.daily.delete",
  "content.daily.restore",
]);
export const OWNER_B3_ACTIONS = new Set([
  "miniapp.import.preview",
  "miniapp.import.commit",
  "miniapp.backup.export",
  "miniapp.backup.restore",
  "miniapp.content.board",
]);
export const ANY_B3_ACTIONS = new Set(["miniapp.subscribe.config", "miniapp.subscribe.record"]);
export const isBatch3Action = (action: string) =>
  OWNER_B3_ACTIONS.has(action) || ANY_B3_ACTIONS.has(action) || action.startsWith("content.");

function unwrap(r: unknown) {
  const res = r as { ok?: boolean; data?: unknown; code?: string; error?: string } | null;
  if (res && res.ok === true) return res.data;
  throw deny(res?.code || "B3_FAILED", res?.error || "云端操作未完成，请稍后重试");
}
const isHttps = (s: unknown): s is string => typeof s === "string" && /^https:\/\/[^\s]{1,2000}$/.test(s);

/** 取一段大数据：直接带的字符串，或 wx.cloud.CDN 换来的 https 地址 */
async function bigText(d: Batch3Deps, inline: unknown, url: unknown, max: number, label: string) {
  if (typeof inline === "string") {
    if (Buffer.byteLength(inline) > max) throw deny("B3_TOO_LARGE", `${label}太大`);
    return inline;
  }
  if (isHttps(url)) {
    if (!d.fetchText) throw deny("B3_NO_FETCH", "暂不支持大文件，请在网页上操作");
    return d.fetchText(url, max);
  }
  throw deny("B3_BAD_PAYLOAD", "请求格式无效");
}
function parseJson(text: string, label: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw deny("B3_BAD_JSON", `${label}不是有效的文件`);
  }
}
function gunzipB64(b64: string, max: number) {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw deny("B3_BAD_PAYLOAD", "备份文件内容无效");
  try {
    const out = gunzipSync(Buffer.from(b64, "base64"), { maxOutputLength: max });
    return out.toString("utf8");
  } catch {
    throw deny("B3_BAD_PAYLOAD", "备份文件读不出来，或超过 20MB");
  }
}

/** 返回 undefined 表示不是第 3 批的调用（交还门卫） */
export async function handleBatch3(
  d: Batch3Deps,
  store: MiniStore,
  who: B3Who,
  action: string,
  p: Record<string, unknown>,
): Promise<{ data: unknown } | undefined> {
  if (!isBatch3Action(action)) return undefined;
  if (who.role === "none") throw deny("NO_ACCESS", "无权限");
  if (ANY_B3_ACTIONS.has(action)) return { data: await subscribe(d, store, who, action, p) };
  // 账本设置、内容都只给管理员（网页同样只给管理员）
  if (who.role !== "owner") throw deny("ADMIN_ONLY", "这个操作只有管理员可以进行");
  if (action.startsWith("content.")) {
    if (!CONTENT_MINI_ACTIONS.has(action)) throw deny("NOT_IN_MINIAPP", "小程序里暂不支持这个操作");
    if (!d.content) throw deny("NOT_IN_MINIAPP", "内容录入暂未开放");
    return { data: unwrap(await d.content(who.uid, { action, payload: p })) };
  }
  switch (action) {
    case "miniapp.import.preview":
    case "miniapp.import.commit": {
      const rows = parseJson(await bigText(d, p.rowsJson, p.rowsUrl, B3_LIMITS.importMaxBytes, "表格"), "表格");
      const payload: Record<string, unknown> = { rows, digest: p.digest };
      if (action === "miniapp.import.commit") payload.fileName = p.fileName;
      return { data: unwrap(await d.business(who.uid, { action: action.slice("miniapp.".length), payload })) };
    }
    case "miniapp.backup.export": {
      const backup = unwrap(await d.business(who.uid, { action: "backup", payload: {} })) as { exportedAt?: string };
      const json = JSON.stringify(backup);
      const gz = gzipSync(Buffer.from(json, "utf8"), { level: 9 }).toString("base64");
      if (gz.length > B3_LIMITS.replyMaxBytes)
        throw deny("BACKUP_TOO_LARGE", "账本太大，小程序发不出完整备份，请在网页上下载");
      return { data: { gz, bytes: Buffer.byteLength(json), exportedAt: backup.exportedAt ?? d.now() } };
    }
    case "miniapp.backup.restore": {
      const b64 = await bigText(d, p.backupGz, p.backupUrl, B3_LIMITS.backupMaxBytes, "备份文件");
      const backup = parseJson(gunzipB64(b64, B3_LIMITS.backupMaxBytes), "备份文件");
      return { data: unwrap(await d.business(who.uid, { action: "backup.restore", payload: { backup } })) };
    }
    case "miniapp.content.board":
      if (!d.board) throw deny("NOT_IN_MINIAPP", "内容看板暂未开放");
      return { data: d.board() };
  }
  throw deny("NOT_IN_MINIAPP", "小程序里暂不支持这个操作");
}

async function subscribe(d: Batch3Deps, store: MiniStore, who: B3Who, action: string, p: Record<string, unknown>) {
  const kinds = SUB_KINDS.filter((k) => d.config.templates[k] && (k !== "apply" || who.role === "owner"));
  const id = who.bindId;
  const saved = id ? await store.get<MiniSub>("miniapp_subs", id) : null;
  const quota = (k: SubKind) => (saved && saved.uid === who.uid ? saved.quota[k] ?? 0 : 0);
  const view = () => ({
    enabled: d.config.notifyEnabled,
    templates: Object.fromEntries(kinds.map((k) => [k, d.config.templates[k]!])),
    quota: Object.fromEntries(kinds.map((k) => [k, quota(k)])),
  });
  if (action === "miniapp.subscribe.config") return view();
  // record：只认小程序来源、只认已配置的模板。发送开关关着时仍记下额度，到点发不发另由 MINIAPP_NOTIFY_ENABLED 控制。
  if (!id || !who.openid) throw deny("NO_ACCESS", "无权限");
  const results = p.results && typeof p.results === "object" && !Array.isArray(p.results) ? (p.results as Record<string, unknown>) : {};
  const accepted = kinds.filter((k) => results[d.config.templates[k]!] === "accept");
  if (!accepted.length) return { ...view(), recorded: 0 };
  const time = d.now();
  const next = await store.transaction(async (tx) => {
    const old = await tx.get<MiniSub>("miniapp_subs", id);
    const base: MiniSub =
      old && old.uid === who.uid
        ? old
        : { id, uid: who.uid, kind: who.role === "owner" ? "owner" : "member", openid: who.openid!, quota: { task: 0, apply: 0 }, updatedAt: time, sent: [], applyNotifiedAt: null };
    const row: MiniSub = {
      ...base,
      openid: who.openid!,
      kind: who.role === "owner" ? "owner" : "member",
      quota: { ...base.quota },
      updatedAt: time,
    };
    for (const k of accepted) row.quota[k] = Math.min(B3_LIMITS.quotaMax, (row.quota[k] ?? 0) + 1);
    await tx.put("miniapp_subs", id, row);
    return row;
  });
  return {
    enabled: d.config.notifyEnabled,
    templates: Object.fromEntries(kinds.map((k) => [k, d.config.templates[k]!])),
    quota: Object.fromEntries(kinds.map((k) => [k, next.quota[k] ?? 0])),
    recorded: accepted.length,
  };
}

/** 云端取 CDN 内容：只认 https、限大小、限时；不跟随跳转 */
export async function fetchCdnText(url: string, maxBytes: number): Promise<string> {
  if (!isHttps(url)) throw deny("B3_BAD_PAYLOAD", "请求格式无效");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), B3_LIMITS.fetchTimeoutMs);
  try {
    const res = await fetch(url, { redirect: "error", signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error("fetch");
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) throw deny("B3_TOO_LARGE", "文件太大");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        ctrl.abort();
        throw deny("B3_TOO_LARGE", "文件太大");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (e) {
    if (e instanceof B3Error) throw e;
    throw deny("B3_FETCH_FAILED", "文件没传上来，请重试");
  } finally {
    clearTimeout(timer);
  }
}

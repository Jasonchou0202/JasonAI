/**
 * 小程序云函数 miniapp 的类型和常量（第 1 批）。
 * - 只给 miniapp 函数用；sales 函数一行不引用这里（sales 包逐字节不变）。
 * - 新集合规则全关（database.rules.json），只有云函数服务端能读写。
 */
export const MINIAPP_COLLECTIONS = [
  "miniapp_bindings",
  "miniapp_bind_codes",
  "miniapp_applications",
  "miniapp_attempts",
  "miniapp_subs",
] as const;
export type MiniappCollection = (typeof MINIAPP_COLLECTIONS)[number];

/** miniapp 函数用的存储：业务集合 + 小程序集合（云端就是同一个 CloudStore） */
export interface MiniTx {
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T>(collection: string, id: string, value: T): Promise<void>;
  del(collection: string, id: string): Promise<void>;
}
export interface MiniStore extends MiniTx {
  list<T>(collection: string): Promise<T[]>;
  transaction<T>(fn: (tx: MiniTx) => Promise<T>): Promise<T>;
}

/** 请求来源：只认平台上下文，不认请求里带的任何身份字段 */
export type Source =
  | { kind: "miniapp"; openid: string; appid: string }
  | { kind: "web"; uid: string };

export interface Binding {
  id: string;
  kind: "owner" | "member";
  uid: string;
  status: "active" | "revoked";
  /** 发订阅消息要用（第 3 批）；永不返回前端、不进日志 */
  openid?: string;
  createdAt: string;
  approvedBy: string;
  lastSeenAt: string | null;
  revokedAt?: string | null;
  revokedBy?: string | null;
}
export interface BindCode {
  id: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
  usedAt: string | null;
  usedBy: string | null;
}
export type ApplicationStatus = "pending" | "approved" | "rejected" | "blocked";
export interface Application {
  id: string;
  /** 对应的绑定编号（哈希，不是 openid） */
  bindId: string;
  /** 批准为新成员时用的 uid：wx_ + 32 位哈希 */
  wxUid: string;
  name: string;
  /** 只有管理员在审批列表里能看到完整号码；被拒绝 30 天后清空 */
  phone: string;
  status: ApplicationStatus;
  /** 30 天内每次申请的时间（用来限 30 天最多 3 次） */
  history: string[];
  createdAt: string;
  lastAppliedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  linkUid?: string | null;
  phonePurgedAt?: string | null;
}
export interface Attempts {
  count: number;
  since: string;
}

/** 防刷和绑定码的参数（和方案第 3 节一致） */
export const LIMITS = {
  codeLength: 8,
  codeTtlMs: 10 * 60_000,
  redeemMaxFails: 5,
  redeemWindowMs: 24 * 3600_000,
  ownerMaxBindings: 2,
  rejectCooldownMs: 24 * 3600_000,
  applyWindowMs: 30 * 24 * 3600_000,
  applyMaxInWindow: 3,
  maxPending: 20,
  maxPerHour: 10,
  phonePurgeMs: 30 * 24 * 3600_000,
  lastSeenEveryMs: 24 * 3600_000,
} as const;
/** 绑定码字符：去掉 0 O 1 I L 这些容易看混的 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

import { ApiError, errorCode, type Me } from "./team-me";
import { cloud, configured } from "./cloud";
import { demoMiniappPreview, createDemoMiniapp } from "./miniapp-demo";

/** 网页调独立的 miniapp 云函数，不经过 sales */
export const MINIAPP_FUNCTION = "miniapp";

export interface MiniappApi {
  call<T>(action: string, payload?: unknown): Promise<T>;
}

export interface MiniappFlags {
  miniappEnabled: boolean;
  membersEnabled: boolean;
  auditEnabled: boolean;
  scheduleOwnerEnabled: boolean;
  avatarsEnabled: boolean;
  salesActorFieldsEnabled: boolean;
  expensesEnabled: boolean;
  salesPayerEnabled: boolean;
  expenseReceiptsEnabled: boolean;
  expenseRenewEnabled: boolean;
  invoiceEnabled: boolean;
}

export interface MiniappApplication {
  id: string;
  name: string;
  phone: string;
  status: "pending" | "approved" | "rejected" | "blocked";
  lastAppliedAt: string;
  decidedAt?: string | null;
  linkUid?: string | null;
  maybe?: { uid: string; name: string; status: string }[];
}

export interface MiniappApplicationList {
  pending: MiniappApplication[];
  blocked: MiniappApplication[];
  rejected: MiniappApplication[];
}

export interface MiniappBinding {
  id: string;
  kind: "owner" | "member";
  uid: string;
  name: string;
  status: "active" | "revoked";
  createdAt: string;
  lastSeenAt?: string | null;
}

export interface BindCodeResult {
  code: string;
  expiresAt: string;
}

/** 网页 members.me 已经能对照的开关（不改 sales） */
export const COMPARABLE_FLAGS = [
  ["membersEnabled", "成员功能"],
  ["auditEnabled", "操作日志"],
  ["scheduleOwnerEnabled", "日程归属"],
  ["avatarsEnabled", "成员头像"],
  ["expensesEnabled", "报销记账"],
  ["salesPayerEnabled", "销售付款人"],
  ["invoiceEnabled", "开票"],
] as const;

export type ComparableFlag = (typeof COMPARABLE_FLAGS)[number][0];

/** 这三项 sales 的 members.me 还不返回；对照它们必须改 sales，本期不动 */
export const UNCOMPARABLE_FLAG_LABELS = ["销售录入人", "报销凭证", "续费提醒"] as const;

export function salesFlagsFromMe(me: Pick<Me, ComparableFlag>): Record<ComparableFlag, boolean> {
  return {
    membersEnabled: !!me.membersEnabled,
    auditEnabled: !!me.auditEnabled,
    scheduleOwnerEnabled: !!me.scheduleOwnerEnabled,
    avatarsEnabled: !!me.avatarsEnabled,
    expensesEnabled: !!me.expensesEnabled,
    salesPayerEnabled: !!me.salesPayerEnabled,
    invoiceEnabled: !!me.invoiceEnabled,
  };
}

export type FlagRow = {
  key: ComparableFlag;
  label: string;
  sales: boolean;
  miniapp: boolean;
  match: boolean;
};

export function compareFlags(
  sales: Record<ComparableFlag, boolean>,
  miniapp: Pick<MiniappFlags, ComparableFlag>,
): { ok: boolean; rows: FlagRow[] } {
  const rows: FlagRow[] = COMPARABLE_FLAGS.map(([key, label]) => {
    const a = !!sales[key];
    const b = !!miniapp[key];
    return { key, label, sales: a, miniapp: b, match: a === b };
  });
  return { ok: rows.every((r) => r.match), rows };
}

export function isMiniappMember(m: { uid?: string; inviteId?: string }) {
  return m.inviteId === "miniapp" || (!!m.uid && m.uid.startsWith("wx_"));
}

const MISSING_FN = new Set([
  "FUNCTION_NOT_FOUND",
  "FUNCTION_NOTEXIST",
  "RESOURCE_NOT_FOUND",
  "FUNCTIONS_EXECUTE_FAIL",
]);

/** 开关关着、函数不存在，或其它探活失败：入口整段隐藏 */
export function isMiniappHiddenError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === "MINIAPP_OFF") return true;
  if (code && MISSING_FN.has(code.toUpperCase().replace(/-/g, "_"))) return true;
  const text = error instanceof Error ? error.message : "";
  return /FUNCTION_NOT_FOUND|函数不存在|找不到云函数|does not exist/i.test(text);
}

async function invokeMiniapp<T>(action: string, payload: unknown = {}): Promise<T> {
  if (!navigator.onLine) throw new Error("网络已断开，草稿已保留，请联网后重试");
  const app = await cloud();
  try {
    const response = await app.callFunction({
      name: MINIAPP_FUNCTION,
      data: { action, payload },
    });
    const result = response.result;
    if (!result || typeof result.ok !== "boolean")
      throw new Error("小程序后台响应异常，请稍后重试");
    if (!result.ok) {
      const code =
        typeof result.code === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(result.code)
          ? result.code
          : undefined;
      throw new ApiError(result.error || "操作未完成", code);
    }
    return result.data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = errorCode(error);
    if (code) throw new ApiError(error instanceof Error ? error.message : "操作未完成", code);
    throw error;
  }
}

export const miniappCloudApi: MiniappApi = {
  call: invokeMiniapp,
};

export type MiniappProbe =
  | { status: "ready"; api: MiniappApi; flags: MiniappFlags }
  | { status: "hidden" }
  | { status: "pending" };

/** 探活：演示预览走示例数据；否则调 miniapp.flags，失败或关闭则整段隐藏 */
export async function probeMiniapp(): Promise<Exclude<MiniappProbe, { status: "pending" }>> {
  if (demoMiniappPreview()) {
    const api = createDemoMiniapp();
    const flags = await api.call<MiniappFlags>("miniapp.flags");
    return { status: "ready", api, flags };
  }
  if (!configured) return { status: "hidden" };
  try {
    const flags = await miniappCloudApi.call<MiniappFlags>("miniapp.flags");
    if (!flags?.miniappEnabled) return { status: "hidden" };
    return { status: "ready", api: miniappCloudApi, flags };
  } catch (error) {
    if (isMiniappHiddenError(error) || error) return { status: "hidden" };
    return { status: "hidden" };
  }
}


/** 北京时间：11月18日 15:05，避免数字日期换行粘在一起 */
export function bjDateText(iso: string) {
  const s = new Date(Date.parse(iso) + 8 * 3600_000).toISOString();
  return `${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日 ${s.slice(11, 16)}`;
}

/** 管理员可见的手机号排版：138 0000 1111 / 137 **** 3333 */
export function formatAdminPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  const masked = phone.trim().match(/^(\d{3})\*+(\d{4})$/);
  if (masked) return `${masked[1]} **** ${masked[2]}`;
  return phone;
}

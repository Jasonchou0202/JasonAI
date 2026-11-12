import type { Api } from "../domain/model";

/** 当前登录人的角色。没有团队功能（开关关、旧后台、演示）时一律按管理员处理，界面与原来一致。 */
export interface Me {
  uid: string;
  role: "admin" | "member" | "none";
  name: string;
  status: "active" | "pending" | "disabled" | "none";
  membersEnabled: boolean;
  auditEnabled: boolean;
  auditHealth?: { failed?: number; lastFailedAt?: string } | null;
}
export const LEGACY_ME: Me = {
  uid: "",
  role: "admin",
  name: "管理员",
  status: "active",
  membersEnabled: false,
  auditEnabled: false,
};

/** 云函数业务错误：把返回里的 code 带着，判断时不靠中文提示。 */
export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const CODE_RE = /^[A-Za-z0-9_.-]{1,100}$/;
function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/-/g, "_");
}

/** 从错误对象取出稳定的错误码（云函数 result.code 或 SDK code）。 */
export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const raw = (error as { code: unknown }).code;
  if (typeof raw !== "string" || !CODE_RE.test(raw)) return undefined;
  return raw;
}

/** 当前云函数尚未返回这些码；前端先认下，后端补上即可生效。 */
const FEATURE_OFF_CODES = new Set([
  "UNSUPPORTED_ACTION",
  "UNKNOWN_ACTION",
  "FEATURE_OFF",
  "MEMBERS_DISABLED",
  "TEAM_DISABLED",
  "NOT_IMPLEMENTED",
]);

const AUTH_CODES = new Set([
  "NOT_SIGNED_IN",
  "UNAUTHENTICATED",
  "AUTH_EXPIRED",
  "AUTH_INVALID",
  "AUTH_REQUIRED",
  "NOT_LOGIN",
  "LOGIN_REQUIRED",
  "SESSION_EXPIRED",
  "TOKEN_EXPIRED",
  "AUTH_INVALID_ACCESS_TOKEN",
  "INVALID_ACCESS_TOKEN",
]);

/** 明确「功能未开」：只按错误码判断，不比对中文。 */
export function isFeatureOffError(error: unknown): boolean {
  const code = errorCode(error);
  return !!code && FEATURE_OFF_CODES.has(normalizeCode(code));
}

/** 未登录 / 会话过期：只按错误码判断。 */
export function isAuthError(error: unknown): boolean {
  const code = errorCode(error);
  return !!code && AUTH_CODES.has(normalizeCode(code));
}

/** members.me 的结果：成功（含明确「功能未开」）、登录失效、或暂时连不上。 */
export type WhoAmI =
  | { status: "ok"; me: Me }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

/** 自动补拉一次的等待（毫秒），避免断网时立刻连打。 */
export const ME_AUTO_RETRY_MS = 1500;

/** 身份还没确认时，不按默认管理员露出入口。 */
export function visibleMe(me: Me, ready: boolean): Me {
  return ready ? me : { ...LEGACY_ME, role: "none" };
}

/** 问云端「我是谁」；明确未开按原来的单人管理员；登录失效与网络失败分开。 */
export async function whoAmI(api: Api): Promise<WhoAmI> {
  try {
    return { status: "ok", me: { ...LEGACY_ME, ...(await api.call<Me>("members.me")) } };
  } catch (error) {
    if (isFeatureOffError(error)) return { status: "ok", me: LEGACY_ME };
    if (isAuthError(error)) return { status: "unauthenticated" };
    return { status: "unavailable" };
  }
}

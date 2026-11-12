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

/** members.me 的结果：成功（含明确「功能未开」）或暂时连不上。 */
export type WhoAmI = { status: "ok"; me: Me } | { status: "unavailable" };

/** 旧后台 / 单人路径没有 members.me 时返回「不支持的操作」，视为功能明确未开。 */
export function isFeatureOffError(error: unknown): boolean {
  return error instanceof Error && error.message === "不支持的操作";
}

/** 问云端「我是谁」；明确未开按原来的单人管理员；网络等临时失败不假装成未开。 */
export async function whoAmI(api: Api): Promise<WhoAmI> {
  try {
    return { status: "ok", me: { ...LEGACY_ME, ...(await api.call<Me>("members.me")) } };
  } catch (error) {
    if (isFeatureOffError(error)) return { status: "ok", me: LEGACY_ME };
    return { status: "unavailable" };
  }
}

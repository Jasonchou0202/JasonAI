import { createContext, useContext, type ReactNode } from "react";
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
/** 问云端「我是谁」；后台没有这个接口（开关关/旧版本）就按原来的单人管理员 */
export async function whoAmI(api: Api): Promise<Me> {
  try {
    return { ...LEGACY_ME, ...(await api.call<Me>("members.me")) };
  } catch {
    return LEGACY_ME;
  }
}
const TeamContext = createContext<Me>(LEGACY_ME);
export function TeamProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <TeamContext.Provider value={me}>{children}</TeamContext.Provider>;
}
export function useTeam() {
  const me = useContext(TeamContext);
  const isAdmin = me.role === "admin";
  return {
    me,
    isAdmin,
    /** 只是界面提示：成员只能改/删自己录的（旧数据无录入人 = 管理员）。真正的拦截在云端。 */
    canChange: (row: { createdBy?: string }) => isAdmin || (!!row.createdBy && row.createdBy === me.uid),
  };
}

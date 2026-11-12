import { createContext, useContext, type ReactNode } from "react";
import { LEGACY_ME, type Me } from "./team-me";
export type { Me, WhoAmI } from "./team-me";
export {
  ApiError,
  LEGACY_ME,
  ME_AUTO_RETRY_MS,
  errorCode,
  isAuthError,
  isFeatureOffError,
  visibleMe,
  whoAmI,
} from "./team-me";

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

import type { Quadrant } from "./insights";

export interface EffectiveAction {
  id: string;
  quadrant: Quadrant;
  text: string;
  preset?: boolean;
}
export const PRESET_ACTIONS: EffectiveAction[] = (
  [
    ["oldOld", "核心客户维护好，持续赋能，增加粘度"],
    ["oldOld", "断购客户转化为复购"],
    ["oldNew", "沟通了解新需求"],
    ["newOld", "老客户转介绍"],
    ["newOld", "复制打法，增加曝光和漏斗入口进水"],
    ["newOld", "分销机制"],
    ["newOld", "加微信未成交的客户转化为成交的客户（朋友圈运营）"],
    ["newNew", "有需求进来后再考虑找新产品"],
    [
      "newNew",
      "找AI赛道新的需求，设计产品，需了解目标市场和目标客户，深度了解其爱好和痛点",
    ],
    ["newNew", "通过AI来做市场调研，找大家公认的痛点和需求"],
  ] as [Quadrant, string][]
).map(([quadrant, text], i) => ({
  id: "preset-" + i,
  quadrant,
  text,
  preset: true,
}));

const QS = ["newOld", "newNew", "oldOld", "oldNew"];
/** 读回本地保存的动作库；格式不对就回到预设 */
export function parseActions(raw: unknown): EffectiveAction[] {
  if (!Array.isArray(raw)) return PRESET_ACTIONS.map((a) => ({ ...a }));
  return raw
    .filter(
      (a) =>
        a &&
        typeof a.id === "string" &&
        QS.includes(a.quadrant) &&
        typeof a.text === "string" &&
        a.text.trim() &&
        a.text.length <= 200,
    )
    .map((a) => ({
      id: a.id,
      quadrant: a.quadrant,
      text: a.text.trim(),
      ...(a.preset ? { preset: true } : {}),
    }));
}
/** 把动作插入「事项」：已有内容时换行追加，带象限标记 */
export function insertAction(
  current: string,
  label: string,
  action: EffectiveAction,
): string {
  const line = `【${label}】${action.text}`;
  return current.trim() ? current.replace(/\s*$/, "") + "\n" + line : line;
}

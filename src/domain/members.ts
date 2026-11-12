/**
 * 日程归属 + 成员固定颜色：前后端共用的唯一取色/取归属函数。
 * 颜色来自 members.color（c1～c7，入队时写入后不再改）；管理员（Jason）固定珊瑚橙，不在 members 集合里。
 */
export type ColorKey = "c1" | "c2" | "c3" | "c4" | "c5" | "c6" | "c7";
export interface MemberColor {
  key: ColorKey | "owner" | "none" | "system";
  name: string;
  /** 色点 / 头像外圈 */
  dot: string;
  /** 色点描边（只有 Jason 有） */
  stroke?: string;
  /** 左侧 3px 色条 */
  bar: string;
  /** 标签浅底 */
  tint: string;
  /** 默认头像底色（白字对比度 ≥ 4.5:1） */
  avatarBg: string;
}
export const OWNER_COLOR: MemberColor = {
  key: "owner", name: "珊瑚橙", dot: "#D97757", stroke: "#B4532F", bar: "#C9603F", tint: "#FAECE7", avatarBg: "#B4532F",
};
/** 7 色分配顺序（品牌视觉官复审版）；第 8 位起从墨蓝循环 */
export const PALETTE: readonly MemberColor[] = [
  { key: "c1", name: "墨蓝", dot: "#3D5A80", bar: "#3D5A80", tint: "#E4E8ED", avatarBg: "#3D5A80" },
  { key: "c2", name: "赭金", dot: "#A8781E", bar: "#A8781E", tint: "#F3ECDF", avatarBg: "#976C1B" },
  { key: "c3", name: "梅紫", dot: "#8A4F7D", bar: "#8A4F7D", tint: "#EFE6ED", avatarBg: "#8A4F7D" },
  { key: "c4", name: "橄榄绿", dot: "#6E7B32", bar: "#6E7B32", tint: "#EBEDE2", avatarBg: "#6E7B32" },
  { key: "c5", name: "栗棕", dot: "#7B5B45", bar: "#7B5B45", tint: "#EDE8E5", avatarBg: "#7B5B45" },
  { key: "c6", name: "岩灰蓝", dot: "#66708F", bar: "#66708F", tint: "#EAEBEF", avatarBg: "#66708F" },
  { key: "c7", name: "玫红", dot: "#A8436A", bar: "#A8436A", tint: "#F3E5EA", avatarBg: "#A8436A" },
];
/** 还没分到颜色的人：灰色，写「未分配」 */
export const UNASSIGNED_COLOR: MemberColor = {
  key: "none", name: "未分配", dot: "#B8A79B", bar: "#B8A79B", tint: "#F1ECE8", avatarBg: "#7A6A5F",
};
/** 系统操作（iPhone 同步、自动补建客户）：空心圆环 1.5px #B8A79B */
export const SYSTEM_COLOR: MemberColor = {
  key: "system", name: "系统", dot: "transparent", stroke: "#B8A79B", bar: "#B8A79B", tint: "#F6F2EF", avatarBg: "transparent",
};
/** 标签文字一律深棕 */
export const TAG_TEXT = "#2B211C";
export const COLOR_KEYS = PALETTE.map((c) => c.key) as ColorKey[];
export function isColorKey(v: unknown): v is ColorKey {
  return typeof v === "string" && (COLOR_KEYS as string[]).includes(v);
}
/** 第 n 个（从 0 起）分到颜色的成员用哪个色 */
export function colorKeyAt(n: number): ColorKey {
  return COLOR_KEYS[((n % COLOR_KEYS.length) + COLOR_KEYS.length) % COLOR_KEYS.length];
}
/**
 * 唯一取色入口：uid → 颜色。
 * - uid 是管理员 → 珊瑚橙；system:* → 系统圆环；成员按 members.color；没有颜色 → 未分配灰。
 */
export function memberColor(
  uid: string | null | undefined,
  ownerUid: string,
  colorOf: (uid: string) => string | null | undefined,
): MemberColor {
  if (!uid) return UNASSIGNED_COLOR;
  if (uid === ownerUid) return OWNER_COLOR;
  if (uid.startsWith("system:")) return SYSTEM_COLOR;
  const key = colorOf(uid);
  return PALETTE.find((c) => c.key === key) ?? UNASSIGNED_COLOR;
}
/** 日程归属：ownerUid → createdBy → 管理员（老日程没有这两个字段，算 Jason 的） */
export function taskOwner(
  task: { ownerUid?: string | null; createdBy?: string | null } | null | undefined,
  ownerUid: string,
): string {
  return task?.ownerUid || task?.createdBy || ownerUid;
}
/** 默认头像的字：姓氏（第一个字）；英文名取首字母大写 */
export function avatarInitial(name: string | null | undefined): string {
  const first = Array.from((name || "").trim())[0] ?? "?";
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

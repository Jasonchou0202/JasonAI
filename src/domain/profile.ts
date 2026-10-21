/** 客户画像：职业、需求、偏好付款方式（均为可选，旧客户档案无需迁移） */
export const PAYMENT_METHODS = ["微信支付", "支付宝支付", "闲鱼支付", "对公账户支付"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const OCCUPATION_PRESETS = [
  "律师", "大学体育老师", "心理咨询师", "在读博士生", "在读研究生",
  "大学老师", "自媒体创业者", "临床医生", "打工人", "英语老师",
];
export const NEED_PRESETS = ["Claude 质保需求", "AI 视频生成", "Agent 学习", "Grok Bot"];

export interface CustomerProfile {
  occupation?: string;
  needs?: string[];
  needNote?: string;
  payment?: PaymentMethod;
}

const label = (v: unknown, max = 40) =>
  typeof v === "string" && v.trim() && v.trim().length <= max && !/[\u0000-\u001f]/.test(v);

/** 校验并规范化画像；只接受这几个字段，其余一律丢弃 */
export function validateProfile(raw: unknown): CustomerProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("客户信息格式无效");
  const p = raw as Record<string, unknown>;
  const out: CustomerProfile = {};
  if (p.occupation !== undefined && p.occupation !== "") {
    if (!label(p.occupation)) throw new Error("职业标签须为 1–40 字");
    out.occupation = (p.occupation as string).trim();
  }
  if (p.needs !== undefined) {
    if (!Array.isArray(p.needs) || p.needs.length > 30 || !p.needs.every((n) => label(n)))
      throw new Error("客户需求选项无效");
    const needs = [...new Set((p.needs as string[]).map((n) => n.trim()))];
    if (needs.length) out.needs = needs;
  }
  if (p.needNote !== undefined && p.needNote !== "") {
    if (typeof p.needNote !== "string" || p.needNote.length > 2000) throw new Error("需求记录最多 2000 字");
    out.needNote = p.needNote;
  }
  if (p.payment !== undefined && p.payment !== "") {
    if (!PAYMENT_METHODS.includes(p.payment as PaymentMethod)) throw new Error("付款方式无效");
    out.payment = p.payment as PaymentMethod;
  }
  return out;
}

/** 选项列表 = 预设 ∪ 已用过的值 ∪ 本机新增的值，保持预设在前、去重 */
export function mergeOptions(presets: readonly string[], ...more: (readonly string[])[]): string[] {
  return [...new Set([...presets, ...more.flat().filter((v) => label(v)).map((v) => v.trim())])];
}

export type PurchaseStatus = "repeat" | "lapsed" | "new" | null;
export const PURCHASE_STATUS_RULE = {
  repeat: "复购客户：至少 2 个月有付款，从首次购买月份到最近购买月份每个月都有付款、没有空月，且最近一次付款在本月或上月",
  lapsed: "断购客户：最近一次付款距今超过 2 个月（最近付款日早于今天往前推 2 个月的同一天）",
  new: "新客：只有一个月份有付款，且不属于断购",
};
function shiftMonth(month: string, n: number) {
  let [y, m] = month.split("-").map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
/** 今天往前推 n 个月的同一天（月末不足时取该月最后一天） */
export function monthsAgo(day: string, n: number) {
  const month = shiftMonth(day.slice(0, 7), -n);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(day.slice(8)), last)).padStart(2, "0")}`;
}
export function purchaseStatus(dates: readonly string[], today: string): PurchaseStatus {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  const last = sorted.at(-1)!;
  if (last < monthsAgo(today, 2)) return "lapsed";
  const months = new Set(sorted.map((d) => d.slice(0, 7)));
  if (months.size < 2) return "new";
  const thisMonth = today.slice(0, 7);
  if (last.slice(0, 7) !== thisMonth && last.slice(0, 7) !== shiftMonth(thisMonth, -1)) return null;
  for (let m = sorted[0].slice(0, 7); m <= last.slice(0, 7); m = shiftMonth(m, 1))
    if (!months.has(m)) return null;
  return "repeat";
}

/** 需求占比：分母 = 记录了至少一项需求的客户数 */
export function needShares(profiles: readonly (CustomerProfile | undefined)[]) {
  const withNeeds = profiles.filter((p) => p?.needs?.length);
  const counts = new Map<string, number>();
  for (const p of withNeeds) for (const n of p!.needs!) counts.set(n, (counts.get(n) ?? 0) + 1);
  const total = withNeeds.length;
  return {
    total,
    rows: [...counts]
      .map(([need, count]) => ({ need, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count || a.need.localeCompare(b.need)),
  };
}

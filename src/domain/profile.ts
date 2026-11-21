/** 客户画像：职业、需求、偏好付款方式（均为可选，旧客户档案无需迁移） */
export const PAYMENT_METHODS = ["微信支付", "支付宝支付", "闲鱼支付", "对公账户支付"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const OCCUPATION_PRESETS = [
  "律师", "大学体育老师", "心理咨询师", "在读博士生", "在读研究生",
  "大学老师", "自媒体创业者", "临床医生", "打工人", "英语老师",
];
export const CLAUDE_NEED = "Claude 质保需求";
export const NEED_PRESETS = [CLAUDE_NEED, "AI 视频生成", "Agent 学习", "Grok Bot"];

/** 勾选「Claude 质保需求」后记录的 Claude 账号：只记邮箱和手机号，不存任何密码 */
export const CLAUDE_TYPES = ["Claude Max", "Claude Ultra"] as const;
export const CLAUDE_USAGES = ["网页端", "终端"] as const;
export const CLAUDE_COMPUTERS = ["Windows 电脑", "苹果电脑"] as const;
export const CLAUDE_ACCOUNTS_MAX = 20;
export interface ClaudeAccount {
  type: (typeof CLAUDE_TYPES)[number];
  usage: (typeof CLAUDE_USAGES)[number];
  computer: (typeof CLAUDE_COMPUTERS)[number];
  email: string;
  /** 只有使用方式为「网页端」时才有 */
  hubStudioPhone?: string;
}

export interface CustomerProfile {
  occupation?: string;
  needs?: string[];
  needNote?: string;
  payment?: PaymentMethod;
  /** 只在需求含「Claude 质保需求」时保存；旧档案没有这个字段，无需迁移 */
  claudeAccounts?: ClaudeAccount[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 手机号：允许 +、空格、短横线和打码星号；数字 4–15 位，总长 ≤ 24（国际号也能过） */
export function validPhone(v: string) {
  const t = v.trim();
  const digits = t.replace(/\D/g, "").length;
  return /^\+?[\d*][\d*\s-]*$/.test(t) && t.length <= 24 && digits >= 4 && digits <= 15 && t.replace(/[^\d*]/g, "").length >= 5;
}
export function validEmail(v: string) {
  const t = v.trim();
  return t.length <= 120 && EMAIL_RE.test(t);
}
/** 账号卡还一项都没填（视为「待补」，保存时跳过） */
export function blankClaudeAccount(a: Partial<Record<keyof ClaudeAccount, unknown>>) {
  return !a.type && !a.usage && !a.computer && !String(a.email ?? "").trim() && !String(a.hubStudioPhone ?? "").trim();
}

/** 校验 Claude 账号列表；只接受已知字段（password 等一律丢弃），选「终端」时不保存 HubStudio 手机号 */
export function validateClaudeAccounts(raw: unknown): ClaudeAccount[] {
  if (!Array.isArray(raw) || raw.length > CLAUDE_ACCOUNTS_MAX) throw new Error(`Claude 账号最多 ${CLAUDE_ACCOUNTS_MAX} 条`);
  return raw.map((r, i) => {
    const no = `第 ${i + 1} 个 Claude 账号`;
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error(`${no}格式无效`);
    const a = r as Record<string, unknown>;
    if (!CLAUDE_TYPES.includes(a.type as ClaudeAccount["type"])) throw new Error(`${no}：请选择账号类型（Claude Max / Claude Ultra）`);
    if (!CLAUDE_USAGES.includes(a.usage as ClaudeAccount["usage"])) throw new Error(`${no}：请选择使用方式（网页端 / 终端）`);
    if (!CLAUDE_COMPUTERS.includes(a.computer as ClaudeAccount["computer"])) throw new Error(`${no}：请选择 Claude 配置电脑类型`);
    if (typeof a.email !== "string" || !a.email.trim()) throw new Error(`${no}：请填写 Claude 注册邮箱`);
    if (!validEmail(a.email)) throw new Error(`${no}：Claude 注册邮箱格式不对`);
    const out: ClaudeAccount = { type: a.type as ClaudeAccount["type"], usage: a.usage as ClaudeAccount["usage"], computer: a.computer as ClaudeAccount["computer"], email: a.email.trim() };
    if (out.usage === "网页端") {
      if (typeof a.hubStudioPhone !== "string" || !a.hubStudioPhone.trim()) throw new Error(`${no}：网页端需填写 HubStudio 注册手机号`);
      if (!validPhone(a.hubStudioPhone)) throw new Error(`${no}：HubStudio 注册手机号格式不对`);
      out.hubStudioPhone = a.hubStudioPhone.trim();
    }
    return out;
  });
}

/** 查看态的一行摘要：① Max · 网页端 · Windows 电脑 · 邮箱 · HubStudio 手机号 */
export function claudeAccountSummary(a: ClaudeAccount, index: number) {
  const no = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"[index] ?? `${index + 1}.`;
  return [`${no} ${a.type.replace(/^Claude /, "")}`, a.usage, a.computer, a.email, ...(a.hubStudioPhone ? [`HubStudio ${a.hubStudioPhone}`] : [])].join(" · ");
}

const label = (v: unknown, max = 40) =>
  typeof v === "string" && v.trim() && v.trim().length <= max && !/[\u0000-\u001f]/.test(v);

/** 校验并规范化画像；只接受这几个字段（含 Claude 账号），其余一律丢弃 */
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
    // 去掉换行和制表符以外的控制字符
    const note = p.needNote.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
    if (note.trim()) out.needNote = note;
  }
  if (p.payment !== undefined && p.payment !== "") {
    if (!PAYMENT_METHODS.includes(p.payment as PaymentMethod)) throw new Error("付款方式无效");
    out.payment = p.payment as PaymentMethod;
  }
  // 没勾「Claude 质保需求」时不写入账号；空卡跳过；password 等未知字段在校验时丢弃
  if (p.claudeAccounts !== undefined && out.needs?.includes(CLAUDE_NEED)) {
    if (!Array.isArray(p.claudeAccounts) || p.claudeAccounts.length > CLAUDE_ACCOUNTS_MAX)
      throw new Error(`Claude 账号最多 ${CLAUDE_ACCOUNTS_MAX} 条`);
    for (const a of p.claudeAccounts)
      if (!a || typeof a !== "object" || Array.isArray(a)) throw new Error("Claude 账号格式无效");
    const filled = p.claudeAccounts.filter((a) => !blankClaudeAccount(a as Partial<Record<keyof ClaudeAccount, unknown>>));
    const accounts = validateClaudeAccounts(filled);
    if (accounts.length) out.claudeAccounts = accounts;
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

/**
 * 客户合并时把来源客户的信息并入目标：需求取并集（最多 30 项）；目标已有的职业、付款方式保留，
 * 没有才用来源的（Claude 账号同理：目标已有就保留目标的）；需求记录按「目标 —— 来源」顺序拼接（最多 2000 字）。
 */
export function mergeProfiles(target?: CustomerProfile, source?: CustomerProfile): CustomerProfile | undefined {
  if (!source) return target;
  if (!target) return { ...source };
  const out: CustomerProfile = {};
  const occupation = target.occupation || source.occupation;
  if (occupation) out.occupation = occupation;
  const needs = [...new Set([...(target.needs ?? []), ...(source.needs ?? [])])].slice(0, 30);
  if (needs.length) out.needs = needs;
  const notes = [target.needNote, source.needNote].filter((n) => n?.trim());
  if (notes.length) out.needNote = notes.join("\n——\n").slice(0, 2000);
  const payment = target.payment || source.payment;
  if (payment) out.payment = payment;
  const accounts = target.claudeAccounts?.length ? target.claudeAccounts : source.claudeAccounts;
  if (accounts?.length) {
    out.claudeAccounts = accounts.map((a) => {
      const x: ClaudeAccount = { type: a.type, usage: a.usage, computer: a.computer, email: a.email };
      if (a.usage === "网页端" && a.hubStudioPhone) x.hubStudioPhone = a.hubStudioPhone;
      return x;
    });
  }
  return out;
}

/** 需求占比按合并后的根客户统计，并入已合并客户的信息（兼容云端更新前就合并的客户） */
export function needSharesByRoot(
  customers: readonly { id: string; mergedInto: string | null; archivedAt?: string | null; profile?: CustomerProfile }[],
) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const rootOf = (id: string) => {
    for (let i = 0; i < 1000; i++) {
      const c = byId.get(id);
      if (!c?.mergedInto) return id;
      id = c.mergedInto;
    }
    return id;
  };
  const byRoot = new Map<string, CustomerProfile | undefined>();
  for (const c of customers) {
    if (c.archivedAt) continue;
    const root = rootOf(c.id);
    byRoot.set(root, mergeProfiles(byRoot.get(root), c.profile));
  }
  return needShares([...byRoot.values()]);
}

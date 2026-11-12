/**
 * 操作日志的大白话：把 action、目标、改前改后从字段名翻成中文（只在日程归属开关开时用，关时原样显示）。
 * 只用日志里已有的白名单摘要 + 成员目录 + 客户列表，不多查任何数据。
 */
import { displayCustomerName } from "../domain/customers";

export interface AuditRowLike {
  action: string;
  targetType?: string;
  targetId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}
type Names = { person: (uid: string) => string; customer: (id: string) => string | undefined };

const ACTIONS: Record<string, string> = {
  "sales.create": "记一笔销售",
  "sales.update": "改销售记录",
  "sales.delete": "删除销售记录",
  "sales.restore": "恢复销售记录",
  "sales.purge": "彻底删除销售记录",
  "tasks.create": "新建日程",
  "tasks.update": "改日程",
  "tasks.complete": "完成日程",
  "tasks.reopen": "重开日程",
  "tasks.delete": "删除日程",
  "tasks.restore": "恢复日程",
  "tasks.purge": "彻底删除日程",
  "tasks.claim": "认领日程",
  "tasks.assign": "指派日程",
  "tasks.sync.complete": "iPhone 上完成日程",
  "tasks.sync.uncomplete": "iPhone 上取消完成",
  "tasks.sync.create": "iPhone 上新建日程",
  "customers.autoCreate": "自动补建客户",
  "customers.merge": "合并客户",
  "customers.unmerge": "拆开客户",
  "customers.mergeMany": "批量合并客户",
  "customers.profile.save": "改客户资料",
  "catalog.cleanup": "清理商品/客户",
  "catalog.restore": "恢复商品/客户",
  "products.create": "新建商品",
  "products.save": "改商品",
  "import.commit": "导入数据",
  "backup.restore": "从备份恢复",
  backup: "导出备份",
  "push.subscribe": "开启推送",
  "push.unsubscribe": "关闭推送",
  "push.test": "测试推送",
  "members.invite.create": "生成邀请",
  "members.invite.revoke": "作废邀请",
  "members.redeem": "用邀请申请入队",
  "members.approve": "批准入队",
  "members.disable": "停用成员",
  "members.enable": "恢复成员",
  "members.color.fill": "给已有成员补色",
  "members.avatar.set": "换头像",
  "members.avatar.clear": "清除头像",
  "audit.list": "查看操作日志",
};
export function actionText(r: AuditRowLike) {
  if (r.action === "tasks.delete" && r.after?.othersRecord === true) return "删除日程（别人的）";
  return ACTIONS[r.action] ?? r.action;
}

const COLOR_NAMES: Record<string, string> = { c1: "墨蓝", c2: "赭金", c3: "梅紫", c4: "橄榄绿", c5: "栗棕", c6: "岩灰蓝", c7: "玫红", owner: "珊瑚橙" };
const FIELDS: Record<string, string> = {
  ownerUid: "归属人",
  owner: "归属人",
  createdBy: "创建人",
  updatedBy: "修改人",
  deletedBy: "删除人",
  title: "事项",
  at: "时间",
  date: "日期",
  customer: "客户",
  customerId: "客户",
  productName: "商品",
  revenue: "销售额",
  cost: "成本",
  note: "备注",
  feedback: "反馈",
  nextAction: "下一步",
  completedAt: "完成",
  deletedAt: "删除",
  reminder: "提醒",
  status: "状态",
  color: "颜色",
  avatar: "头像",
  name: "名字",
  mergedInto: "并入",
  archivedAt: "归档",
  count: "数量",
  price: "价格",
};
/** 只是版本号、编号之类的内部字段：不显示 */
const HIDDEN = new Set(["revision", "uid", "ids", "colors", "oldFileKept", "othersRecord", "profileKeys", "hasDefaultPrice", "hasDefaultCost", "summary", "hour"]);
const PERSON_FIELDS = new Set(["ownerUid", "owner", "createdBy", "updatedBy", "deletedBy"]);
const STATUS: Record<string, string> = { active: "使用中", disabled: "已停用", pending: "待批准" };
const REMINDER: Record<string, string> = { off: "不提醒", due: "到时提醒", both: "提前 + 到时提醒" };

/** ISO 时间 → 北京时间「11-12 10:00」 */
export function bjShort(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = new Date(t + 8 * 3600_000).toISOString();
  return `${s.slice(5, 10)} ${s.slice(11, 16)}`;
}
function value(k: string, x: unknown, n: Names): string {
  if (x === null || x === undefined || x === "") {
    if (k === "deletedAt") return "未删除";
    if (k === "completedAt") return "未完成";
    if (k === "avatar") return "默认头像";
    return "空";
  }
  if (PERSON_FIELDS.has(k) && typeof x === "string") return n.person(x);
  if (k === "deletedAt") return "已删除";
  if (k === "completedAt") return "已完成";
  if (k === "avatar") return "新头像";
  if (k === "color" && typeof x === "string") return COLOR_NAMES[x] ?? x;
  if (k === "status" && typeof x === "string") return STATUS[x] ?? x;
  if (k === "reminder" && typeof x === "string") return REMINDER[x] ?? x;
  if (k === "customerId" && typeof x === "string") return n.customer(x) ?? "某位客户";
  if (k === "customer" && typeof x === "string") return displayCustomerName(x);
  if (k === "at" && typeof x === "string") return bjShort(x);
  if (typeof x === "boolean") return x ? "是" : "否";
  if (Array.isArray(x)) return `${x.length} 项`;
  if (typeof x === "object") return "…";
  return String(x);
}
const label = (k: string) => FIELDS[k] ?? k;

/** 改前 → 改后：只列变化的字段，字段名、人名、时间都翻成大白话，最多 3 项 */
export function diffText(r: AuditRowLike, n: Names): string[] {
  const { before, after } = r;
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => !HIDDEN.has(k));
  if (r.action === "customers.autoCreate" && after) return [`补建了 ${String(after.count ?? 1)} 位客户`];
  if (r.action === "members.color.fill" && after) return [`补了 ${String(after.count ?? 0)} 位成员的颜色`];
  if (!before || !after) {
    const one = after || before;
    if (!one) return [];
    // 新建只给关键的一两项，删除只说删了什么
    const main = keys(one).filter((k) => k !== "deletedAt" && k !== "completedAt").slice(0, 2);
    return main.map((k) => `${label(k)}：${value(k, one[k], n)}`);
  }
  const changed = [...new Set([...keys(before), ...keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (!changed.length) return ["无变化"];
  // 改前没有这个字段（只是日志补记的，如删除时补上的归属人）：只写现在的值，不写「空 →」
  const lines = changed
    .slice(0, 3)
    .map((k) =>
      before[k] === undefined && after[k] !== undefined
        ? `${label(k)}：${value(k, after[k], n)}`
        : `${label(k)}：${value(k, before[k], n)} → ${value(k, after[k], n)}`,
    );
  if (changed.length > 3) lines.push(`等 ${changed.length} 项`);
  return lines;
}

/** 目标：显示能看懂的名字（客户名、日程事项、成员名），拿不到才退回「某条…」 */
export function targetText(r: AuditRowLike, n: Names): string {
  const s = { ...(r.before ?? {}), ...(r.after ?? {}) } as Record<string, unknown>;
  const id = r.targetId ?? "";
  switch (r.targetType) {
    case "tasks": {
      const who = typeof s.customerId === "string" ? n.customer(s.customerId) : undefined;
      const title = typeof s.title === "string" ? s.title : "";
      return [who, title].filter(Boolean).join(" · ") || "某条日程";
    }
    case "sales": {
      const who = typeof s.customer === "string" ? displayCustomerName(s.customer) : "";
      const what = typeof s.productName === "string" ? s.productName : "";
      return [who, what].filter(Boolean).join(" · ") || "某条销售记录";
    }
    case "customers": {
      if (typeof s.name === "string") return displayCustomerName(s.name);
      const ids = Array.isArray(s.ids) ? (s.ids as string[]) : id ? [id] : [];
      const names = ids.map((x) => n.customer(x)).filter((x): x is string => !!x);
      if (names.length) return names.slice(0, 2).join("、") + (ids.length > 2 ? ` 等 ${ids.length} 位` : "");
      return ids.length > 1 ? `${ids.length} 位客户` : "某位客户";
    }
    case "members":
      if (id === "_owner_profile") return "Jason";
      if (r.action === "members.color.fill") return "已入队成员";
      return id ? n.person(id) : typeof s.name === "string" ? s.name : "成员";
    case "invites":
      return typeof s.name === "string" ? `邀请 · ${s.name}` : "邀请";
    case "products":
      return typeof s.name === "string" ? s.name : "商品";
    default:
      return "—";
  }
}

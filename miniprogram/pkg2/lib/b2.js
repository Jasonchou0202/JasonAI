// 自动生成，勿手改：node scripts/build-miniapp-b2.mjs
"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value2) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value: value2 }) : obj[key] = value2;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/miniapp-b2/index.ts
var index_exports = {};
__export(index_exports, {
  AUDIT_RANGES: () => AUDIT_RANGES,
  DECADE_SHARES_DESC: () => DECADE_SHARES_DESC,
  EXPENSE_START_DATE: () => EXPENSE_START_DATE,
  FIELD_KEYS: () => FIELD_KEYS,
  FIELD_LABEL: () => FIELD_LABEL,
  INVOICE_COLORS: () => INVOICE_COLORS,
  INVOICE_FILE_MAX: () => INVOICE_FILE_MAX,
  INVOICE_FILE_MAX_BYTES: () => INVOICE_FILE_MAX_BYTES,
  INVOICE_STATUS_CHOICES: () => INVOICE_STATUS_CHOICES,
  INVOICE_STATUS_FILTERS: () => INVOICE_STATUS_FILTERS,
  ISSUED_LIKE: () => ISSUED_LIKE,
  NEED_PRESETS: () => NEED_PRESETS,
  NEW_RULE_TEXT: () => NEW_RULE_TEXT,
  OCCUPATION_PRESETS: () => OCCUPATION_PRESETS,
  PAYMENT_METHODS: () => PAYMENT_METHODS,
  PROFIT_SHARE_START_DATE: () => PROFIT_SHARE_START_DATE,
  QUADRANTS: () => QUADRANTS,
  QUADRANT_INFO: () => QUADRANT_INFO,
  RECEIPT_KINDS: () => RECEIPT_KINDS,
  RECEIPT_KIND_LABEL: () => RECEIPT_KIND_LABEL,
  RECEIPT_MAX_FILES: () => RECEIPT_MAX_FILES,
  RELAY_MAX_BYTES: () => RELAY_MAX_BYTES,
  WEB_URL: () => WEB_URL,
  addDays: () => addDays,
  auditView: () => auditView,
  bjTime: () => bjTime,
  compareBars: () => compareBars,
  customerDetailView: () => customerDetailView,
  decadeShareTitle: () => decadeShareTitle,
  decadeSharesView: () => decadeSharesView,
  defaultSalesView: () => defaultSalesView,
  deriveHasInvoice: () => deriveHasInvoice,
  displayCustomerName: () => displayCustomerName,
  expensesView: () => expensesView,
  formatCnDate: () => formatCnDate,
  inSalesView: () => inSalesView,
  inviteLink: () => inviteLink,
  invoiceAmountInput: () => invoiceAmountInput,
  invoiceFileCheck: () => invoiceFileCheck,
  invoiceFileMime: () => invoiceFileMime,
  invoiceRow: () => invoiceRow,
  invoiceStatsView: () => invoiceStatsView,
  invoiceStatusLabel: () => invoiceStatusLabel,
  invoiceSteps: () => invoiceSteps,
  lineChart: () => lineChart,
  matrixView: () => matrixView,
  membersView: () => membersView,
  mergeCandidates: () => mergeCandidates,
  money: () => money,
  monthLabel: () => monthLabel,
  parseInvoiceAmount: () => parseInvoiceAmount,
  parseYuan: () => parseYuan,
  pendingRow: () => pendingRow,
  profileOptions: () => profileOptions,
  quadMonthsView: () => quadMonthsView,
  receiptEntry: () => receiptEntry,
  receiptMime: () => receiptMime,
  receiptSummary: () => receiptSummary,
  renewLabel: () => renewLabel,
  renewName: () => renewName,
  renewRemindDate: () => renewRemindDate,
  requestId: () => requestId,
  salesViewHint: () => salesViewHint,
  selectableCategories: () => selectableCategories,
  shareLabel: () => shareLabel,
  shiftMonth: () => shiftMonth,
  sizeLabel: () => sizeLabel,
  slashDate: () => slashDate,
  today: () => today,
  trashExpense: () => trashExpense,
  trashSale: () => trashSale,
  trashTask: () => trashTask,
  yuan: () => yuan
});
module.exports = __toCommonJS(index_exports);

// src/miniapp-b2/intl.ts
var pad = (n) => String(n).padStart(2, "0");
var FallbackDateTimeFormat = class {
  constructor(_locale, opts = {}) {
    this.opts = opts;
  }
  format(date = /* @__PURE__ */ new Date()) {
    const t = typeof date === "number" ? date : date.getTime();
    const d = new Date(t + 8 * 36e5);
    const day = [this.opts.year ? String(d.getUTCFullYear()) : "", this.opts.month ? pad(d.getUTCMonth() + 1) : "", this.opts.day ? pad(d.getUTCDate()) : ""].filter(Boolean);
    const time = [this.opts.hour ? pad(d.getUTCHours()) : "", this.opts.minute ? pad(d.getUTCMinutes()) : ""].filter(Boolean);
    return [day.join("-"), time.join(":")].filter(Boolean).join(" ");
  }
};
var FallbackNumberFormat = class {
  constructor(_locale, _opts = {}) {
  }
  format(value2) {
    const n = Math.round(Math.abs(value2));
    const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return value2 < 0 && n ? "-" + s : s;
  }
};
function nativeOk() {
  try {
    const g = globalThis.Intl;
    if (!g) return false;
    const d = new g.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.UTC(2026, 0, 1, 20)));
    const n = new g.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(12345);
    return d === "2026-01-02" && n === "12,345";
  } catch (e) {
    return false;
  }
}
var OK = nativeOk();
var native = globalThis.Intl;
var SafeIntl = {
  DateTimeFormat: function(locale, opts) {
    return OK && native ? new native.DateTimeFormat(locale, opts) : new FallbackDateTimeFormat(locale, opts);
  },
  NumberFormat: function(locale, opts) {
    return OK && native ? new native.NumberFormat(locale, opts) : new FallbackNumberFormat(locale, opts);
  }
};

// src/domain/dates.ts
function today(now = /* @__PURE__ */ new Date()) {
  return new SafeIntl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}
function addDays(date, n) {
  const d = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// src/domain/customers.ts
var TRAILING_IP = /\s*((?:\d{1,3}\.){3}\d{1,3})$/;
function displayCustomerName(name) {
  const trimmed = name.trim();
  const withoutCheck = trimmed.replace(/✅/g, "").trim();
  const match = TRAILING_IP.exec(withoutCheck);
  const withoutIP = match && match[1].split(".").every((n) => Number(n) <= 255) ? withoutCheck.slice(0, match.index).trim() : withoutCheck;
  return withoutIP || withoutCheck || trimmed;
}
function customerProducts(sales) {
  const products = /* @__PURE__ */ new Map();
  for (const sale of sales) {
    const item = products.get(sale.productName) || {
      name: sale.productName,
      profit: 0,
      count: 0
    };
    item.profit += sale.revenue - sale.cost;
    item.count++;
    products.set(item.name, item);
  }
  return [...products.values()].sort(
    (a, b) => b.profit - a.profit || b.count - a.count || a.name.localeCompare(b.name)
  );
}

// src/domain/finance.ts
var MAX_MONEY = 99999999999;
function parseMoney(value2) {
  const s = String(value2 != null ? value2 : "").trim().replace(/^(-?)\s*[¥￥]\s*/, "$1").replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s))
    throw new Error("金额须为数字，最多两位小数");
  const neg = s.startsWith("-");
  const [a, b = ""] = s.replace("-", "").split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > MAX_MONEY)
    throw new Error("金额超出支持范围");
  return neg ? -n : n;
}
var roundYuan = (cents) => Math.sign(cents) * Math.round(Math.abs(cents) / 100) || 0;
var money = (value2) => new SafeIntl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
  roundYuan(value2)
);
var moneyInput = (value2) => value2 % 100 === 0 ? String(value2 / 100) : (value2 / 100).toFixed(2);
function parseYuan(value2, original) {
  const s = String(value2 != null ? value2 : "").trim().replace(/^(-?)\s*[¥￥]\s*/, "$1").replace(/,/g, "");
  if (original !== void 0 && s === moneyInput(original)) return original;
  if (!/^-?\d+$/.test(s)) throw new Error("金额只填到元（整数，不带小数）");
  return parseMoney(s);
}
var emptyTotals = () => ({
  revenue: 0,
  cost: 0,
  profit: 0,
  count: 0
});
function totals(rows) {
  return rows.reduce(
    (t, r) => ({
      revenue: t.revenue + r.revenue,
      cost: t.cost + r.cost,
      profit: t.profit + r.revenue - r.cost,
      count: t.count + 1
    }),
    emptyTotals()
  );
}

// src/domain/expenses.ts
var EXPENSE_STATUS_LABEL = {
  pending_confirm: "待确认",
  rejected: "已驳回",
  pending_reimburse: "待报销",
  reimbursed: "已报销"
};
var RETIRED_CATEGORY_IDS = /* @__PURE__ */ new Set(["cat-software"]);
function selectableCategories(categories) {
  return categories.filter((c) => !c.archivedAt && !RETIRED_CATEGORY_IDS.has(c.id));
}
var RECEIPT_KINDS = ["invoice", "no_invoice", "payment"];
var RECEIPT_KIND_LABEL = {
  invoice: "发票",
  no_invoice: "无发票说明",
  payment: "支付凭证"
};
var RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
var RECEIPT_MAX_FILES = 9;
var RECEIPT_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
var EXT_MIME = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif"
};
function receiptMime(name, type) {
  var _a;
  const t = (type || "").toLowerCase();
  if (RECEIPT_MIME.includes(t)) return t;
  if (t && t !== "application/octet-stream") return null;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return (_a = EXT_MIME[ext]) != null ? _a : null;
}
function deriveHasInvoice(receipts, fallback) {
  if (!receipts || receipts.length === 0) return fallback;
  return receipts.some((r) => r.kind === "invoice");
}
function shareLabel(share) {
  return share >= 0 ? `${Math.round(share * 100)}%` : "";
}
function receiptSummary(row) {
  const list = row.receipts || [];
  if (!list.length) return row.hasInvoice ? "有发票" : "无发票";
  return RECEIPT_KINDS.map((k) => [k, list.filter((r) => r.kind === k).length]).filter(([, n]) => n > 0).map(([k, n]) => `${RECEIPT_KIND_LABEL[k]}${n > 1 ? ` ×${n}` : ""}`).join(" · ");
}
var OWNER_LABEL = "章鱼哥";
var PARTNER_LABEL = "周诗懿";
var EXPENSE_START_DATE = "2026-11-14";
var PROFIT_SHARE_START_DATE = "2026-11-21";
function formatCnDate(date, withYear = false) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return withYear ? `${y} 年 ${m} 月 ${d} 日` : `${m} 月 ${d} 日`;
}
var PROFIT_SHARE_HINT = `${formatCnDate(PROFIT_SHARE_START_DATE)}起开始分成`;
var PROFIT_SHARE_BEFORE_HINT = `${formatCnDate(PROFIT_SHARE_START_DATE)}前不分成，利润全归${OWNER_LABEL}，${PARTNER_LABEL}为 0`;
var PROFIT_SHARE_BEFORE_REFUND_HINT = `${formatCnDate(PROFIT_SHARE_START_DATE)}前不分成，${PARTNER_LABEL}分成为 0；${formatCnDate(EXPENSE_START_DATE)}起${PARTNER_LABEL}垫付的报销照退给她`;
var EXPENSE_START_TOO_EARLY = `报销从 ${formatCnDate(EXPENSE_START_DATE, true)}起记，不能录入更早的日期`;
function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

// src/domain/invoices.ts
var INVOICE_STATUS_LABEL = {
  awaiting_info: "待收资料",
  pending: "待开票",
  issued: "已开票",
  sent: "已寄出",
  void: "已作废",
  red: "已红冲"
};
var OPEN_STATUSES = ["awaiting_info", "pending"];
var INVOICE_FILE_MAX_BYTES = 4 * 1024 * 1024;
var INVOICE_FILE_MAX = 6;
var INVOICE_MIME = ["application/pdf", "image/png", "image/jpeg"];
var EXT_MIME2 = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg"
};
function invoiceFileMime(name) {
  var _a, _b, _c, _d;
  const ext = (_c = (_b = (_a = /\.([a-z0-9]+)$/i.exec(name.trim())) == null ? void 0 : _a[1]) == null ? void 0 : _b.toLowerCase()) != null ? _c : "";
  return (_d = EXT_MIME2[ext]) != null ? _d : null;
}
var FIELD_KEYS = ["title", "taxNo", "addressPhone", "bankAccount", "email"];
var FIELD_LABEL = {
  title: "抬头",
  taxNo: "税号",
  addressPhone: "地址电话",
  bankAccount: "开户行账号",
  email: "收票邮箱"
};

// src/domain/profile.ts
var PAYMENT_METHODS = ["微信支付", "支付宝支付", "闲鱼支付", "对公账户支付"];
var OCCUPATION_PRESETS = [
  "律师",
  "大学体育老师",
  "心理咨询师",
  "在读博士生",
  "在读研究生",
  "大学老师",
  "自媒体创业者",
  "临床医生",
  "打工人",
  "英语老师"
];
var NEED_PRESETS = ["Claude 质保需求", "AI 视频生成", "Agent 学习", "Grok Bot"];
var label = (v, max = 40) => typeof v === "string" && v.trim() && v.trim().length <= max && !/[\u0000-\u001f]/.test(v);
function mergeOptions(presets, ...more) {
  return [.../* @__PURE__ */ new Set([...presets, ...more.flat().filter((v) => label(v)).map((v) => v.trim())])];
}

// src/domain/insights.ts
var QUADRANTS = ["newOld", "newNew", "oldOld", "oldNew"];
var QUADRANT_INFO = {
  newOld: { label: "新客户 × 老产品", short: "新客老品", color: "#C2552F" },
  newNew: { label: "新客户 × 新产品", short: "新客新品", color: "#2F4A6D" },
  oldOld: { label: "老客户 × 老产品", short: "老客老品", color: "#5F7A3A" },
  oldNew: { label: "老客户 × 新产品", short: "老客新品", color: "#A8670F" }
};
var NEW_CUTOFF = "2026-10-21";
var NEW_RULE_TEXT = `${NEW_CUTOFF} 前已有的客户/商品为老，之后新增为新`;
var pct = (n, d) => d ? Math.round(n / d * 1e3) / 10 : 0;

// src/domain/members.ts
var OWNER_COLOR = {
  key: "owner",
  name: "珊瑚橙",
  dot: "#D97757",
  stroke: "#B4532F",
  bar: "#C9603F",
  tint: "#FAECE7",
  avatarBg: "#B4532F"
};
var PALETTE = [
  { key: "c1", name: "墨蓝", dot: "#3D5A80", bar: "#3D5A80", tint: "#E4E8ED", avatarBg: "#3D5A80" },
  { key: "c2", name: "赭金", dot: "#A8781E", bar: "#A8781E", tint: "#F3ECDF", avatarBg: "#976C1B" },
  { key: "c3", name: "梅紫", dot: "#8A4F7D", bar: "#8A4F7D", tint: "#EFE6ED", avatarBg: "#8A4F7D" },
  { key: "c4", name: "橄榄绿", dot: "#6E7B32", bar: "#6E7B32", tint: "#EBEDE2", avatarBg: "#6E7B32" },
  { key: "c5", name: "栗棕", dot: "#7B5B45", bar: "#7B5B45", tint: "#EDE8E5", avatarBg: "#7B5B45" },
  { key: "c6", name: "岩灰蓝", dot: "#66708F", bar: "#66708F", tint: "#EAEBEF", avatarBg: "#66708F" },
  { key: "c7", name: "玫红", dot: "#A8436A", bar: "#A8436A", tint: "#F3E5EA", avatarBg: "#A8436A" }
];
var UNASSIGNED_COLOR = {
  key: "none",
  name: "未分配",
  dot: "#B8A79B",
  bar: "#B8A79B",
  tint: "#F1ECE8",
  avatarBg: "#7A6A5F"
};
var SYSTEM_COLOR = {
  key: "system",
  name: "系统",
  dot: "transparent",
  stroke: "#B8A79B",
  bar: "#B8A79B",
  tint: "#F6F2EF",
  avatarBg: "transparent"
};
var COLOR_KEYS = PALETTE.map((c) => c.key);
function memberColor(uid, ownerUid, colorOf) {
  var _a;
  if (!uid) return UNASSIGNED_COLOR;
  if (uid === ownerUid) return OWNER_COLOR;
  if (uid.startsWith("system:")) return SYSTEM_COLOR;
  const key = colorOf(uid);
  return (_a = PALETTE.find((c) => c.key === key)) != null ? _a : UNASSIGNED_COLOR;
}

// src/domain/entryHelpers.ts
function addMonthsClamp(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  const ty = Math.floor(index / 12), tm = index % 12 + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// src/domain/renew.ts
var RENEW_REMIND_TIME = "10:00";
var RENEW_DAYS_BEFORE = 1;
var RENEW_NAME_MAX = 40;
function renewRemindDate(expenseDate) {
  return addDays(addMonthsClamp(expenseDate, 1), -RENEW_DAYS_BEFORE);
}
function renewName(input, fallback) {
  const raw = typeof input === "string" && input.trim() ? input : fallback;
  return Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, RENEW_NAME_MAX).join("");
}
function renewLabel(date) {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 ${RENEW_REMIND_TIME}`;
}

// src/lib/treemap.ts
function treemap(items, width = 100, height = 100) {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = list.reduce((n, i) => n + i.value, 0);
  if (!total) return [];
  const scale = width * height / total;
  const out = [];
  let x = 0, y = 0, w = width, h = height;
  let row = [];
  const worst = (r, side) => {
    const s = r.reduce((n, i) => n + i.area, 0);
    const max = Math.max(...r.map((i) => i.area));
    const min = Math.min(...r.map((i) => i.area));
    return Math.max(
      side * side * max / (s * s),
      s * s / (side * side * min)
    );
  };
  const flush = () => {
    const s = row.reduce((n, i) => n + i.area, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const r of row) {
        const ch = r.area / cw;
        out.push({ item: r.item, value: r.value, x, y: cy, w: cw, h: ch });
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      const ch = s / w;
      let cx = x;
      for (const r of row) {
        const cw = r.area / ch;
        out.push({ item: r.item, value: r.value, x: cx, y, w: cw, h: ch });
        cx += cw;
      }
      y += ch;
      h -= ch;
    }
    row = [];
  };
  for (const i of list) {
    const next = __spreadProps(__spreadValues({}, i), { area: i.value * scale });
    const side = Math.min(w, h);
    if (row.length && worst([...row, next], side) > worst(row, side)) flush();
    row.push(next);
  }
  if (row.length) flush();
  return out;
}

// src/lib/audit-text.ts
var ACTIONS = {
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
  "audit.list": "查看操作日志"
};
function actionText(r) {
  var _a, _b;
  if (r.action === "tasks.delete" && ((_a = r.after) == null ? void 0 : _a.othersRecord) === true) return "删除日程（别人的）";
  return (_b = ACTIONS[r.action]) != null ? _b : r.action;
}
var COLOR_NAMES = { c1: "墨蓝", c2: "赭金", c3: "梅紫", c4: "橄榄绿", c5: "栗棕", c6: "岩灰蓝", c7: "玫红", owner: "珊瑚橙" };
var FIELDS = {
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
  price: "价格"
};
var HIDDEN = /* @__PURE__ */ new Set(["revision", "uid", "ids", "colors", "oldFileKept", "othersRecord", "profileKeys", "hasDefaultPrice", "hasDefaultCost", "summary", "hour"]);
var PERSON_FIELDS = /* @__PURE__ */ new Set(["ownerUid", "owner", "createdBy", "updatedBy", "deletedBy"]);
var STATUS = { active: "使用中", disabled: "已停用", pending: "待批准" };
var REMINDER = { off: "不提醒", due: "到时提醒", both: "提前 + 到时提醒" };
function bjShort(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = new Date(t + 8 * 36e5).toISOString();
  return `${s.slice(5, 10)} ${s.slice(11, 16)}`;
}
function value(k, x, n) {
  var _a, _b, _c, _d;
  if (x === null || x === void 0 || x === "") {
    if (k === "deletedAt") return "未删除";
    if (k === "completedAt") return "未完成";
    if (k === "avatar") return "默认头像";
    return "空";
  }
  if (PERSON_FIELDS.has(k) && typeof x === "string") return n.person(x);
  if (k === "deletedAt") return "已删除";
  if (k === "completedAt") return "已完成";
  if (k === "avatar") return "新头像";
  if (k === "color" && typeof x === "string") return (_a = COLOR_NAMES[x]) != null ? _a : x;
  if (k === "status" && typeof x === "string") return (_b = STATUS[x]) != null ? _b : x;
  if (k === "reminder" && typeof x === "string") return (_c = REMINDER[x]) != null ? _c : x;
  if (k === "customerId" && typeof x === "string") return (_d = n.customer(x)) != null ? _d : "某位客户";
  if (k === "customer" && typeof x === "string") return displayCustomerName(x);
  if (k === "at" && typeof x === "string") return bjShort(x);
  if (typeof x === "boolean") return x ? "是" : "否";
  if (Array.isArray(x)) return `${x.length} 项`;
  if (typeof x === "object") return "…";
  return String(x);
}
var label2 = (k) => {
  var _a;
  return (_a = FIELDS[k]) != null ? _a : k;
};
function diffText(r, n) {
  var _a, _b;
  const { before, after } = r;
  const keys = (o) => Object.keys(o).filter((k) => !HIDDEN.has(k));
  if (r.action === "customers.autoCreate" && after) return [`补建了 ${String((_a = after.count) != null ? _a : 1)} 位客户`];
  if (r.action === "members.color.fill" && after) return [`补了 ${String((_b = after.count) != null ? _b : 0)} 位成员的颜色`];
  if (!before || !after) {
    const one = after || before;
    if (!one) return [];
    const main = keys(one).filter((k) => k !== "deletedAt" && k !== "completedAt").slice(0, 2);
    return main.map((k) => `${label2(k)}：${value(k, one[k], n)}`);
  }
  const changed = [.../* @__PURE__ */ new Set([...keys(before), ...keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (!changed.length) return ["无变化"];
  const lines = changed.slice(0, 3).map(
    (k) => before[k] === void 0 && after[k] !== void 0 ? `${label2(k)}：${value(k, after[k], n)}` : `${label2(k)}：${value(k, before[k], n)} → ${value(k, after[k], n)}`
  );
  if (changed.length > 3) lines.push(`等 ${changed.length} 项`);
  return lines;
}
function targetText(r, n) {
  var _a, _b, _c;
  const s = __spreadValues(__spreadValues({}, (_a = r.before) != null ? _a : {}), (_b = r.after) != null ? _b : {});
  const id = (_c = r.targetId) != null ? _c : "";
  switch (r.targetType) {
    case "tasks": {
      const who = typeof s.customerId === "string" ? n.customer(s.customerId) : void 0;
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
      const ids = Array.isArray(s.ids) ? s.ids : id ? [id] : [];
      const names = ids.map((x) => n.customer(x)).filter((x) => !!x);
      if (names.length) return names[0] + (ids.length > 1 ? ` 等 ${ids.length} 位` : "");
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

// src/miniapp-b2/index.ts
var WEB_URL = "https://jasonchou0202.github.io/JasonAI/";
var RELAY_MAX_BYTES = 4 * 1024 * 1024;
var yuan = (cents) => `¥${money(cents)}`;
var monthLabel = (month) => `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`;
var slashDate = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
var bjTime = (iso) => new Date(Date.parse(iso) + 8 * 36e5).toISOString().slice(0, 16).replace("T", " ");
function requestId(random = Math.random) {
  let s = "mp-" + Date.now().toString(36) + "-";
  for (let i = 0; i < 16; i++) s += Math.floor(random() * 16).toString(16);
  return s;
}
function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
var SPLIT_FROM = formatCnDate(PROFIT_SHARE_START_DATE);
var PHASE = { closed: "已出账", current: "进行中", upcoming: "待出账 · 示意" };
function decadeView(row, admin) {
  const upcoming = row.phase === "upcoming";
  const n = (v) => upcoming ? "—" : yuan(v);
  return {
    key: row.decade.from,
    label: row.decade.label,
    shortLabel: row.decade.shortLabel,
    phase: row.phase,
    phaseText: PHASE[row.phase],
    profitText: upcoming ? "尚未有数" : yuan(row.profit),
    overviewProfit: upcoming ? "—" : yuan(row.profit),
    upcoming,
    grid: [
      { k: "销售收入", v: n(row.revenue), sub: upcoming ? "" : "来自销售记录" },
      { k: "进货成本", v: n(row.cost), sub: "" },
      { k: "报销成本", v: n(row.expense), sub: "" },
      { k: "总成本", v: n(row.totalCost), sub: "" }
    ],
    splitTitle: row.sharesOpen ? "六四分账" : `分账 · ${SPLIT_FROM}前不分成`,
    ownerLine: `${row.owner.name} ${shareLabel(row.owner.share)}`,
    ownerAmount: n(row.owner.amount),
    partnerLine: `${row.partner.name} ${shareLabel(row.partner.share)}`,
    partnerAmount: n(row.partner.amount),
    ownerAdvanceLine: `${row.owner.name}垫付`,
    ownerAdvance: row.sharesOpen ? n(row.owner.advance) : upcoming ? n(0) : "不用退",
    partnerAdvanceLine: row.sharesOpen ? `${row.partner.name}垫付` : `${row.partner.name}垫付的报销`,
    partnerAdvance: n(row.partner.advance),
    receiveLine: admin && (row.sharesOpen || !upcoming) ? `${row.partner.name}应收回 ${n(row.partnerReceive)}` : "",
    hint: upcoming ? "本段未出账，不做结算" : admin ? `${row.partner.name}应收回 ${yuan(row.partnerReceive)}` : !row.sharesOpen ? PROFIT_SHARE_BEFORE_HINT : "成员只看自己的报销，结算以管理员账本为准",
    hintSmall: !upcoming && admin && !row.sharesOpen ? PROFIT_SHARE_BEFORE_REFUND_HINT : "",
    hintStrong: !upcoming && admin
  };
}
function compareBars(rows) {
  const peak = Math.max(...rows.flatMap((r) => [r.salesProfit, r.profit]), 100);
  const h = (v) => Math.round(Math.max(Math.max(0, v) / peak * 100, v > 0 ? 4 : 0) * 10) / 10;
  return rows.map((r) => ({ month: r.month, label: `${Number(r.month.slice(5, 7))}月`, sales: h(r.salesProfit), actual: h(r.profit), salesText: money(r.salesProfit), actualText: money(r.profit) }));
}
function expensesView(data, admin, month) {
  var _a, _b;
  const m = Number(month.slice(5, 7));
  const booked = data.details.filter((d) => d.status === "pending_reimburse" || d.status === "reimbursed");
  const pending = data.details.filter((d) => d.status === "pending_confirm");
  const postedFrom = (_a = data.decades.find((d) => d.phase !== "upcoming")) == null ? void 0 : _a.decade.from;
  const postedTo = (_b = [...data.decades].reverse().find((d) => d.phase !== "upcoming")) == null ? void 0 : _b.decade.to;
  const anyUpcoming = data.decades.some((d) => d.phase === "upcoming");
  const p = data.posted;
  const cur = data.compare.find((c) => c.month === month);
  return {
    title: monthLabel(month),
    lead: `十天合账。${SPLIT_FROM}起按${data.people.owner.name} 60%、${data.people.partner.name} 40% 分；之前${data.people.partner.name}为 0。`,
    decades: data.decades.map((d) => decadeView(d, admin)),
    posted: admin ? {
      range: postedFrom && postedTo ? `${slashDate(postedFrom)}–${slashDate(postedTo)}` : "",
      metrics: [
        { k: "销售收入", v: yuan(p.revenue) },
        { k: "进货成本", v: yuan(p.cost) },
        { k: "报销成本", v: yuan(p.expense) },
        { k: "总成本", v: yuan(p.totalCost) },
        { k: "实际利润", v: yuan(p.profit) }
      ],
      splitTitle: p.partner.share === 0 ? `分账 · ${SPLIT_FROM}前不分成` : p.partner.share > 0 ? "六四分账" : "分账",
      ownerSplit: `${data.people.owner.name} ${shareLabel(p.owner.share)}　${yuan(p.owner.amount)}`,
      partnerSplit: `${data.people.partner.name} ${shareLabel(p.partner.share)}　${yuan(p.partner.amount)}`,
      receive: `${data.people.partner.name}应收回 ${yuan(p.partnerReceive)}`,
      receiveNote: (p.partner.share === 0 ? `垫付的报销 ${yuan(p.partner.advance)} + 分成 ¥0 · ${PROFIT_SHARE_BEFORE_REFUND_HINT}` : `垫付 ${yuan(p.partner.advance)} + 四成利润 ${yuan(p.partner.amount)}${p.partner.share < 0 ? `（${SPLIT_FROM}起；此前只退垫付的报销）` : ""}`) + (anyUpcoming ? " · 未出账段未计入" : ""),
      profit: yuan(p.profit)
    } : null,
    compare: compareBars(data.compare),
    compareLead: `近 ${data.compare.length} 个月对照。${month === data.today.slice(0, 7) && data.compare.some((c) => c.partial) ? `${m} 月只记已出账或进行中的段。` : ""}`,
    compareNote: `${m} 月${(cur == null ? void 0 : cur.partial) ? "按已记账的段合计" : "整月合计"}（只算销售 ${yuan(p.salesProfit)}，扣成本后 ${yuan(p.profit)}）${anyUpcoming ? "；未出账段未计入。" : "。"}`,
    detailLead: `已入账 ${booked.length} 笔，合计 ${yuan(booked.reduce((n, r) => n + r.amount, 0))}。${pending.length ? `待确认 ${pending.length} 笔尚未入账，不计入合账。` : ""}`,
    pendingCount: admin ? pending.length : 0,
    renewOn: !!data.renewEnabled,
    details: data.details.map((r) => {
      var _a2;
      return {
        id: r.id,
        revision: r.revision,
        date: slashDate(r.date),
        rawDate: r.date,
        category: r.categoryName,
        payer: r.payerName,
        amount: yuan(r.amount),
        receipt: receiptSummary(r),
        receiptCount: ((_a2 = r.receipts) == null ? void 0 : _a2.length) || 0,
        status: r.status,
        statusText: EXPENSE_STATUS_LABEL[r.status],
        note: r.note || "",
        renewText: r.renew ? `已设提醒 · ${Number(r.renew.date.slice(5, 7))}月${Number(r.renew.date.slice(8, 10))}日` : "",
        renewable: !r.renew && r.status !== "rejected",
        renewWhen: renewLabel(renewRemindDate(r.date)),
        own: true
      };
    })
  };
}
function pendingRow(r, people) {
  var _a;
  const payer = r.payerName || (people ? r.paidBy === people.partner.uid ? people.partner.name : people.owner.name : "");
  return { id: r.id, revision: r.revision, date: slashDate(r.date), category: r.categoryName, payer, amount: yuan(r.amount), receipt: receiptSummary(r), receiptCount: ((_a = r.receipts) == null ? void 0 : _a.length) || 0, note: r.note || "" };
}
function receiptEntry(file, kind) {
  const type = receiptMime(file.name, "");
  if (!type) return { error: `「${file.name}」不是 PDF 或图片（JPG、PNG、HEIC、WebP）` };
  if (file.size > RELAY_MAX_BYTES) return { error: `「${file.name}」超过 4MB，请压缩后再传` };
  return { error: "", type, kind: RECEIPT_KINDS.includes(kind) ? kind : "invoice" };
}
var INVOICE_STATUS_CHOICES = ["awaiting_info", "pending", "issued", "sent"];
var INVOICE_STATUS_FILTERS = [{ id: "", label: "全部" }, { id: "open", label: "未开" }, ...INVOICE_STATUS_CHOICES.map((s) => ({ id: s, label: INVOICE_STATUS_LABEL[s] }))];
var INVOICE_COLORS = {
  awaiting_info: { fg: "#5C5854", bg: "#EEEAE4", line: "#D8D3CC" },
  pending: { fg: "#9E2A1E", bg: "#F8DAD4", line: "#E8C0B8" },
  issued: { fg: "#1B6B40", bg: "#E3F6EA", line: "#C5E6D1" },
  sent: { fg: "#0B3D28", bg: "#A8D5B8", line: "#7EBE98" },
  void: { fg: "#5C5854", bg: "#EEEAE4", line: "#D8D3CC" },
  red: { fg: "#5C5854", bg: "#EEEAE4", line: "#D8D3CC" }
};
var invoiceStatusLabel = (s) => {
  var _a;
  return (_a = INVOICE_STATUS_LABEL[s]) != null ? _a : "未知状态";
};
function invoiceRow(r) {
  var _a;
  return {
    id: r.id,
    saleId: r.saleId,
    revision: r.revision,
    customerId: r.customerId,
    customer: r.customerName ? displayCustomerName(r.customerName) : "未填客户",
    product: r.productName,
    saleDate: slashDate(r.saleDate),
    amount: yuan(r.amount),
    status: r.status,
    statusText: invoiceStatusLabel(r.status),
    open: OPEN_STATUSES.includes(r.status),
    retired: r.status === "void" || r.status === "red",
    invoiceNo: r.invoiceNo || "",
    issuedOn: r.issuedOn || "",
    sentTo: r.sentTo || "",
    files: ((_a = r.files) == null ? void 0 : _a.length) || 0,
    profileComplete: r.profileComplete,
    profileText: r.customerId ? r.profileComplete ? "资料齐" : "缺资料" : "未对上客户"
  };
}
function invoiceStatsView(s) {
  return [
    { k: "待开票", v: yuan(s.pending.amount), sub: `${s.pending.count} 笔${s.pending.awaiting ? ` · 其中待收资料 ${s.pending.awaiting}` : ""}`, tone: "pending" },
    { k: `${Number(s.month.slice(5, 7))} 月已开`, v: yuan(s.issued.amount), sub: `${s.issued.count} 笔`, tone: "issued" },
    { k: "缺资料客户", v: `${s.missingCustomers} 位`, sub: s.missingCustomers ? "补齐后才好开票" : "都齐了", tone: s.missingCustomers ? "warn" : "ok" }
  ];
}
function invoiceFileCheck(file, purpose) {
  const mime = invoiceFileMime(file.name);
  if (!mime || purpose === "invoice" && !INVOICE_MIME.includes(mime))
    return purpose === "invoice" ? "发票只支持 PDF 和图片（PNG、JPG）" : "只支持 PDF、Word、txt、PNG、JPG";
  if (file.size > INVOICE_FILE_MAX_BYTES) return "文件不能超过 4MB";
  return "";
}
function inSalesView(view, date, month, thisMonth) {
  const m = date.slice(0, 7);
  if (view === "all") return true;
  if (view === "recent") return m >= shiftMonth(thisMonth, -2) && m <= thisMonth;
  return m === month;
}
function defaultSalesView(sales, thisMonth) {
  if (sales.some((s) => inSalesView("month", s.date, thisMonth, thisMonth))) return "month";
  if (sales.some((s) => inSalesView("recent", s.date, thisMonth, thisMonth))) return "recent";
  return "all";
}
function salesViewHint(view) {
  return view === "recent" ? "本月暂无成交，已为你显示近 3 个月" : view === "all" ? "本月和近 3 个月暂无成交，已为你显示全部" : "";
}
function customerDetailView(sales, view, month, thisMonth, limit = 20) {
  var _a;
  const rows = sales.filter((s) => inSalesView(view, s.date, month, thisMonth)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const t = totals(rows);
  const groups = [];
  for (const s of rows.slice(0, limit)) {
    const key = s.date.slice(0, 7);
    if (((_a = groups[groups.length - 1]) == null ? void 0 : _a.month) !== key) groups.push({ month: key, label: monthLabel(key), items: [] });
    groups[groups.length - 1].items.push(saleLine(s));
  }
  return {
    period: view === "month" ? monthLabel(month) : view === "recent" ? `近 3 个月（${monthLabel(shiftMonth(thisMonth, -2))}至${monthLabel(thisMonth)}）` : "全部历史",
    totals: { revenue: yuan(t.revenue), cost: yuan(t.cost), profit: yuan(t.profit), count: t.count },
    products: customerProducts(rows).slice(0, 8).map((p) => ({ name: p.name, count: p.count, profit: yuan(p.profit) })),
    groups,
    remaining: Math.max(0, rows.length - limit),
    empty: rows.length === 0
  };
}
function saleLine(s) {
  return { id: s.id, date: slashDate(s.date), product: s.productName, revenue: yuan(s.revenue), profit: yuan(s.revenue - s.cost), note: s.note || "", customerName: s.customer };
}
function mergeCandidates(customers, selfId, query) {
  const q = query.trim().toLocaleLowerCase();
  return customers.filter((c) => c.id !== selfId && !c.mergedInto && !c.archivedAt && !c.id.startsWith("expense_") && !c.id.startsWith("invoice_")).filter((c) => !q || c.name.toLocaleLowerCase().includes(q)).slice(0, 30).map((c) => ({ id: c.id, name: displayCustomerName(c.name) }));
}
function profileOptions(used) {
  return {
    occupations: mergeOptions(OCCUPATION_PRESETS, used.map((p) => {
      var _a;
      return (_a = p.occupation) != null ? _a : "";
    })),
    needs: mergeOptions(NEED_PRESETS, used.flatMap((p) => {
      var _a;
      return (_a = p.needs) != null ? _a : [];
    })),
    payments: [...PAYMENT_METHODS]
  };
}
function trashSale(s) {
  return { id: s.id, revision: s.revision, title: s.productName, sub: `${displayCustomerName(s.customer || "未填客户")} · ${s.date}`, amount: yuan(s.revenue), deletedAt: s.deletedAt ? bjTime(s.deletedAt) : "" };
}
function trashTask(t, customerName) {
  return { id: t.id, revision: t.revision, title: t.title, sub: `${customerName(t.customerId)} · ${bjTime(t.at)}`, amount: "", deletedAt: t.deletedAt ? bjTime(t.deletedAt) : "" };
}
function trashExpense(r) {
  return { id: r.id, revision: r.revision, title: r.categoryName, sub: `${r.date} · ${receiptSummary(r)}`, amount: yuan(r.amount), deletedAt: r.deletedAt ? bjTime(r.deletedAt) : "" };
}
var MEMBER_STATUS = { pending: "待批准", active: "使用中", disabled: "已停用" };
function membersView(members, ownerUid, colorsOn) {
  const colorOf = (uid) => {
    var _a;
    return (_a = members.find((m) => m.uid === uid)) == null ? void 0 : _a.color;
  };
  return {
    needFill: colorsOn && members.some((m) => m.status !== "pending" && !m.color),
    owner: { name: "管理员（你）", color: OWNER_COLOR.dot, colorName: `${OWNER_COLOR.name}（固定）` },
    rows: members.map((m) => {
      const c = memberColor(m.uid, ownerUid, colorOf);
      const same = m.color ? members.filter((o) => o.uid !== m.uid && o.color === m.color).map((o) => o.name) : [];
      return {
        uid: m.uid,
        name: m.name,
        status: m.status,
        statusText: MEMBER_STATUS[m.status],
        joined: bjTime(m.createdAt),
        miniapp: m.inviteId === "miniapp" || m.uid.startsWith("wx_"),
        color: m.status === "pending" ? "" : c.dot,
        colorName: m.status === "pending" ? "批准后分色" : c.name,
        sameColor: same.length ? `和${same.join("、")}同色，靠名字区分` : ""
      };
    })
  };
}
var inviteLink = (code) => `${WEB_URL}#/join?code=${encodeURIComponent(code)}`;
function auditView(rows, person, customer) {
  const n = { person, customer };
  return rows.map((r, i) => ({
    key: r.id || `${r.at}-${i}`,
    at: bjShort(r.at),
    who: r.actorName || person(r.actorUid) || "不详",
    action: actionText(r),
    target: targetText(r, n),
    diff: diffText(r, n).join("；"),
    result: r.result,
    resultText: r.result === "ok" ? "" : r.result === "denied" ? "被拒" : "失败",
    via: r.after && r.after.via === "miniapp" ? "小程序" : ""
  }));
}
var AUDIT_RANGES = [
  { id: "", label: "全部", back: -1 },
  { id: "1", label: "今天", back: 0 },
  { id: "7", label: "近 7 天", back: 6 },
  { id: "30", label: "近 30 天", back: 29 }
];
function lineChart(rows, W, H, P = 28) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  const x = (i) => P + (rows.length === 1 ? (W - 2 * P) / 2 : i * (W - 2 * P) / (rows.length - 1));
  const y = (v) => H - P - v / max * (H - 2 * P);
  return { baseline: H - P, points: rows.map((r, i) => ({ x: x(i), y: y(r.count), label: `${Number(r.month.slice(5))}月`, value: r.count })) };
}
function quadMonthsView(rows, end, windowSize = 3) {
  const last = Math.max(rows.length - 1, 0);
  const at = Math.min(Math.max(end, 0), last);
  const shown = rows.slice(Math.max(0, at - windowSize + 1), at + 1);
  return {
    last,
    at,
    minEnd: Math.min(windowSize - 1, last),
    range: shown.length ? `${shown[0].month.replace("-", ".")} – ${shown[shown.length - 1].month.replace("-", ".")}` : "",
    months: shown.map((r) => ({
      month: r.month.replace("-", "."),
      active: r.active,
      cells: treemap(QUADRANTS.map((q) => ({ item: q, value: r.counts[q] }))).map((c) => ({
        q: c.item,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        color: QUADRANT_INFO[c.item].color,
        short: QUADRANT_INFO[c.item].short,
        value: c.value,
        pct: pct(c.value, r.active),
        tiny: c.w < 22 || c.h < 22
      })),
      nums: QUADRANTS.map((q) => ({ q, text: `${QUADRANT_INFO[q].short} ${r.counts[q]}位 · ${pct(r.counts[q], r.active)}%`, color: r.counts[q] ? QUADRANT_INFO[q].color : "", zero: !r.counts[q] }))
    }))
  };
}
var GRID = ["newOld", "newNew", "oldOld", "oldNew"];
function matrixView(t) {
  return GRID.map((q) => ({ q, label: QUADRANT_INFO[q].label, color: QUADRANT_INFO[q].color, on: t[q].count > 0, count: `${t[q].count} 笔`, revenue: `销售额 ${yuan(t[q].revenue)}`, profit: `纯利 ${yuan(t[q].profit)}` }));
}
function decadeShareTitle(row) {
  const m = Number(row.decade.from.slice(5, 7));
  return row.decade.index === 0 ? `${m}月 1–10 日` : row.decade.index === 1 ? `${m}月 11–20 日` : `${m}月 21–月末`;
}
function decadeSharesView(items) {
  return items.map((row) => {
    const upcoming = row.phase === "upcoming";
    return {
      key: row.decade.from,
      title: decadeShareTitle(row),
      phase: row.phase,
      phaseText: PHASE[row.phase],
      ownerLine: `${row.owner.name} ${shareLabel(row.owner.share)}`,
      owner: upcoming ? "—" : yuan(row.owner.amount),
      partnerLine: `${row.partner.name} ${shareLabel(row.partner.share)}`,
      partner: upcoming ? "—" : yuan(row.partner.amount),
      advance: !row.sharesOpen && !upcoming && row.partner.advance > 0 ? { line: `另退${row.partner.name}垫付的报销`, v: yuan(row.partner.advance) } : null,
      wait: row.sharesOpen ? "" : `${formatCnDate(PROFIT_SHARE_START_DATE)}前不分成`
    };
  });
}
var DECADE_SHARES_DESC = `当前段与后两段。${formatCnDate(PROFIT_SHARE_START_DATE)}起六四分，之前周诗懿为 0；${formatCnDate(EXPENSE_START_DATE)}起垫付的报销照退。`;
function parseInvoiceAmount(text) {
  const s = String(text != null ? text : "").trim().replace(/^[¥￥]\s*/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("开票金额填数字，最多两位小数");
  const cents = Math.round(Number(s) * 100);
  if (cents <= 0) throw new Error("开票金额要大于 0");
  return cents;
}
var invoiceAmountInput = (cents) => cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100);
var ISSUED_LIKE = (s) => s === "issued" || s === "sent" || s === "void" || s === "red";
function invoiceSteps(current) {
  const list = current === "void" || current === "red" ? [...INVOICE_STATUS_CHOICES, current] : INVOICE_STATUS_CHOICES;
  return list.map((s) => ({ id: s, label: invoiceStatusLabel(s), color: INVOICE_COLORS[s] }));
}

// 自动生成，勿手改：node scripts/build-miniapp.mjs（源码 src/miniapp + src/domain）
"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
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

// src/miniapp/index.ts
var index_exports = {};
__export(index_exports, {
  CHART_COLORS: () => CHART_COLORS,
  PROFIT_TARGET: () => PROFIT_TARGET,
  REMINDERS: () => REMINDERS,
  addDays: () => addDays,
  agenda: () => agenda,
  axisMoney: () => axisMoney,
  beijingDay: () => beijingDay,
  beijingInput: () => beijingInput,
  beijingToUTC: () => beijingToUTC,
  bell: () => bell,
  bucketBarsLayout: () => bucketBarsLayout,
  canEdit: () => canEdit,
  cleanFilters: () => cleanFilters,
  customerHints: () => customerHints,
  customerNames: () => customerNames,
  customerRootByName: () => customerRootByName,
  dailyPendingTasks: () => dailyPendingTasks,
  dateLabel: () => dateLabel,
  defaultFollowUp: () => defaultFollowUp,
  displayCustomerName: () => displayCustomerName,
  draftDirty: () => draftDirty,
  draftFromSale: () => draftFromSale,
  draftFromTask: () => draftFromTask,
  draftProfit: () => draftProfit,
  drawChart: () => drawChart,
  drawProductBars: () => drawProductBars,
  freshDraft: () => freshDraft,
  freshTask: () => freshTask,
  hitBar: () => hitBar,
  homeView: () => homeView,
  inLunchBreak: () => inLunchBreak,
  money: () => money,
  moneyInput: () => moneyInput,
  monthGrid: () => monthGrid,
  monthRange: () => monthRange,
  niceScale: () => niceScale,
  pageInfo: () => pageInfo,
  parseYuan: () => parseYuan,
  pickProduct: () => pickProduct,
  prepareSave: () => prepareSave,
  presetRange: () => presetRange,
  productBarsLayout: () => productBarsLayout,
  productGroups: () => productGroups,
  profitTargetLayout: () => profitTargetLayout,
  quickProducts: () => quickProducts,
  rankingRows: () => rankingRows,
  requestId: () => requestId,
  saleRow: () => saleRow,
  scheduleDefaults: () => scheduleDefaults,
  scheduleText: () => scheduleText,
  shiftMonth: () => shiftMonth,
  sortTasksTodayFirst: () => sortTasksTodayFirst,
  taskInput: () => taskInput,
  taskRow: () => taskRow,
  taskStatus: () => taskStatus,
  today: () => today,
  totals: () => totals,
  totalsText: () => totalsText,
  trendSummary: () => trendSummary,
  yuan: () => yuan
});
module.exports = __toCommonJS(index_exports);

// src/miniapp/safe-intl.ts
var pad = (n) => String(n).padStart(2, "0");
var FallbackDateTimeFormat = class {
  constructor(locale, opts = {}) {
    this.locale = locale;
    this.opts = opts;
  }
  format(date = /* @__PURE__ */ new Date()) {
    const t = typeof date === "number" ? date : date.getTime();
    const d = new Date(t + 8 * 36e5);
    const parts = [];
    const day = [
      this.opts.year ? String(d.getUTCFullYear()) : "",
      this.opts.month ? pad(d.getUTCMonth() + 1) : "",
      this.opts.day ? pad(d.getUTCDate()) : ""
    ].filter(Boolean);
    if (day.length) parts.push(day.join("-"));
    const time = [this.opts.hour ? pad(d.getUTCHours()) : "", this.opts.minute ? pad(d.getUTCMinutes()) : ""].filter(Boolean);
    if (time.length) parts.push(time.join(":"));
    return parts.join(" ");
  }
};
var FallbackNumberFormat = class {
  constructor(locale, opts = {}) {
    this.locale = locale;
    this.opts = opts;
  }
  format(value) {
    var _a;
    const digits = (_a = this.opts.maximumFractionDigits) != null ? _a : 3;
    const fixed = Math.abs(value).toFixed(Math.min(digits, 20));
    const [int, frac = ""] = fixed.split(".");
    const trimmed = frac.replace(/0+$/, "");
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
    return sign + grouped + (trimmed ? "." + trimmed : "");
  }
};
function nativeIntlWorks(native2) {
  try {
    if (!native2) return false;
    const probe = Date.UTC(2026, 0, 1, 20, 0, 0);
    const day = new native2.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(probe);
    const num = new native2.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(1234567);
    return day === "2026-01-02" && num === "1,234,567";
  } catch (e) {
    return false;
  }
}
var native = typeof Intl !== "undefined" ? Intl : void 0;
var SafeIntl = nativeIntlWorks(native) ? native : { DateTimeFormat: FallbackDateTimeFormat, NumberFormat: FallbackNumberFormat };

// src/domain/profitTarget.ts
var PROFIT_TARGET = {
  /** 目标终点月份 */
  endMonth: "2027-12",
  /** 终点月利润（分）：¥100,000 */
  endProfit: 1e7,
  /** 目标起点月份（固定）：用这个月的实际利润作为起点，不随当前月份变化 */
  startMonth: "2026-09",
  /** 默认可见月数（半年）：本月前 monthsBefore 个月 + 本月 + 之后的月份，其余用滑杆切换 */
  visibleMonths: 6,
  monthsBefore: 2
};
function addMonth(month, n) {
  let [y, m] = month.split("-").map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
function monthDiff(a, b) {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
function targetSeries(startMonth, startProfit, endMonth = PROFIT_TARGET.endMonth, endProfit = PROFIT_TARGET.endProfit) {
  const n = monthDiff(startMonth, endMonth);
  if (n <= 0) return { points: [{ month: endMonth, value: endProfit }], step: 0 };
  const step = (endProfit - startProfit) / n;
  const points = Array.from({ length: n + 1 }, (_, i) => ({
    month: addMonth(startMonth, i),
    value: Math.round(startProfit + step * i)
  }));
  return { points, step };
}
function fixedTarget(months, startProfit) {
  const start = PROFIT_TARGET.startMonth;
  if (typeof startProfit === "number" && Number.isFinite(startProfit))
    return __spreadValues({ startMonth: start, hasStart: true }, targetSeries(start, startProfit));
  const startBucket = months.find((b) => b.key.slice(0, 7) === start);
  if (!startBucket)
    return { startMonth: start, hasStart: false, points: [{ month: PROFIT_TARGET.endMonth, value: PROFIT_TARGET.endProfit }], step: 0 };
  return __spreadValues({ startMonth: start, hasStart: true }, targetSeries(start, startBucket.profit));
}
function anchorMonth(current) {
  return current > PROFIT_TARGET.endMonth ? PROFIT_TARGET.endMonth : current;
}

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
function dateLabel(date) {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
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

// src/domain/catalog.ts
var productCategories = [
  "ChatGPT",
  "Claude",
  "Grok",
  "Gemini",
  "Typeless",
  "Verizon 网络",
  "常规网络",
  "流量网络",
  "账号与接码",
  "开发与安装",
  "培训与教程",
  "视频与工作流",
  "其他"
];
function productCategory(name) {
  if (/chatgpt/i.test(name)) return "ChatGPT";
  if (/claude/i.test(name)) return "Claude";
  if (/gemini/i.test(name)) return "Gemini";
  if (/typeless/i.test(name)) return "Typeless";
  if (/verizon/i.test(name)) return "Verizon 网络";
  if (/常规.*(?:套餐|🪜)/.test(name)) return "常规网络";
  if (/流量|🪜|网络套餐/.test(name)) return "流量网络";
  if (/账号|接码/.test(name)) return "账号与接码";
  if (/开发|安装|codex|skill|api/i.test(name)) return "开发与安装";
  if (/培训|教程/.test(name)) return "培训与教程";
  if (/视频|工作流/.test(name)) return "视频与工作流";
  return "其他";
}
function groupProducts(items) {
  return productCategories.map((category) => ({
    category,
    items: items.filter((p) => {
      var _a;
      return ((_a = p.category) != null ? _a : productCategory(p.name)) === category;
    }).sort(
      (a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })
    )
  })).filter((g) => g.items.length);
}

// src/domain/finance.ts
var MAX_MONEY = 99999999999;
function parseMoney(value) {
  const s = String(value != null ? value : "").trim().replace(/^(-?)\s*[¥￥]\s*/, "$1").replace(/,/g, "");
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
var money = (value) => new SafeIntl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
  roundYuan(value)
);
var moneyInput = (value) => value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2);
function parseYuan(value, original) {
  const s = String(value != null ? value : "").trim().replace(/^(-?)\s*[¥￥]\s*/, "$1").replace(/,/g, "");
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

// src/domain/entryHelpers.ts
function addMonthsClamp(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  const ty = Math.floor(index / 12), tm = index % 12 + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
function inLunchBreak(wall) {
  const hm = wall.slice(-5);
  return hm >= "12:30" && hm < "14:00";
}
function defaultFollowUp(saleDate) {
  return `${addMonthsClamp(saleDate, 1)}T10:00`;
}
function topProfitProducts(sales, products, today2, n = 5, months = 3) {
  var _a, _b;
  const from = addMonthsClamp(today2, -months);
  const usable = products.filter((p) => p.active && !p.archivedAt);
  const byId = new Map(usable.map((p) => [p.id, p]));
  const byName = new Map(usable.map((p) => [p.name, p]));
  const profit = /* @__PURE__ */ new Map();
  for (const s of sales) {
    if (s.deletedAt || s.date < from || s.date > today2) continue;
    const p = (_a = byId.get(s.productId)) != null ? _a : byName.get(s.productName);
    if (!p) continue;
    profit.set(p.id, ((_b = profit.get(p.id)) != null ? _b : 0) + s.revenue - s.cost);
  }
  return usable.filter((p) => profit.has(p.id)).map((p, i) => ({ p, i, v: profit.get(p.id) })).sort((a, b) => b.v - a.v || a.i - b.i).slice(0, n).map((x) => x.p);
}
function quickProducts(sales, products, today2, n = 5, months = 3) {
  const active = groupProducts(
    products.filter((p) => p.active && !p.archivedAt)
  ).reduce((all, g) => all.concat(g.items), []);
  const ranked = topProfitProducts(sales, active, today2, n, months);
  return [...ranked, ...active.filter((p) => !ranked.includes(p))].slice(0, n);
}
function scheduleText(customTitle, productName, actionLines) {
  const custom = customTitle.trim();
  const fallback = productName.trim() ? `续费提醒：${productName.trim()}` : "客户回访";
  const title = (custom || actionLines[0] || fallback).slice(0, 200);
  const rest = custom ? actionLines : actionLines.slice(1);
  return { title, nextAction: rest.join("\n").slice(0, 2e3) };
}
function findCustomerByName(list, name, display) {
  var _a, _b;
  const n = name.trim();
  if (!n) return void 0;
  return (_b = (_a = list.find((c) => c.name === n)) != null ? _a : list.find((c) => !c.mergedInto && display(c.name) === n)) != null ? _b : list.find((c) => display(c.name) === n);
}

// src/domain/tasks.ts
function dailyPendingTasks(tasks, day) {
  return tasks.filter((task) => !task.deletedAt && !task.completedAt && today(new Date(task.at)) === day).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
function sortTasksTodayFirst(tasks, day) {
  const date = (task) => today(new Date(task.at));
  const priority = (task) => date(task) === day ? 0 : date(task) > day ? 1 : 2;
  return [...tasks].sort(
    (a, b) => priority(a) - priority(b) || (priority(a) === 2 ? date(b).localeCompare(date(a)) : 0) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id)
  );
}

// src/miniapp/charts.ts
var CHART_COLORS = {
  coral: "#D97757",
  coralSoft: "#F2C6B4",
  loss: "#9E2A1E",
  ink: "#2B2522",
  muted: "#8A7B70",
  grid: "#EFE7E0",
  target: "#B4532F",
  selected: "#B4532F"
};
function axisMoney(cents) {
  const y = cents / 1e6;
  if (Math.abs(y) >= 1) return `${+y.toFixed(2)}万`;
  return String(Math.round(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function niceScale(v) {
  if (v <= 0) return { max: 1e5, steps: 4 };
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const opts = [[1, 4], [1.2, 4], [1.5, 5], [2, 4], [2.5, 5], [3, 3], [4, 4], [5, 5], [6, 3], [8, 4], [10, 4]];
  const [m, steps] = opts.find(([m2]) => m2 * p >= v);
  return { max: m * p, steps };
}
function frame(width, height, vmax, vmin, steps) {
  const plot = { left: 44, right: width - 6, top: 18, bottom: height - 26 };
  const y = (v) => plot.top + (vmax - v) / (vmax - vmin || 1) * (plot.bottom - plot.top);
  const ticks = Array.from({ length: steps + 1 }, (_, i) => {
    const v = vmax - i * (vmax - vmin) / steps;
    return { y: y(v), label: axisMoney(v) };
  });
  return { plot, y, ticks, zeroY: y(0) };
}
function profitTargetLayout(opts) {
  var _a;
  const { months, current, width, height } = opts;
  if (!months.length) return null;
  const firstData = months[0].key.slice(0, 7);
  const first = firstData < PROFIT_TARGET.startMonth ? firstData : PROFIT_TARGET.startMonth;
  const actual = new Map(months.map((b) => [b.key.slice(0, 7), b]));
  const target = fixedTarget(months, opts.startProfit);
  const targetBy = new Map(target.points.map((p) => [p.month, p.value]));
  const all = Array.from({ length: monthDiff(first, PROFIT_TARGET.endMonth) + 1 }, (_, i) => addMonth(first, i));
  const N = Math.min(PROFIT_TARGET.visibleMonths, all.length);
  const maxStart = all.length - N;
  const curI = Math.max(0, all.indexOf(anchorMonth(current)));
  const fallback = Math.min(maxStart, Math.max(0, curI - PROFIT_TARGET.monthsBefore));
  const start = Math.min(maxStart, Math.max(0, (_a = opts.start) != null ? _a : fallback));
  const view = all.slice(start, start + N);
  const valueOf = (m) => {
    var _a2;
    return m <= current ? (_a2 = actual.get(m)) == null ? void 0 : _a2.profit : void 0;
  };
  const scale = niceScale(Math.max(...view.map((m) => {
    var _a2, _b;
    return Math.max((_a2 = valueOf(m)) != null ? _a2 : 0, (_b = targetBy.get(m)) != null ? _b : 0);
  })) * 1.12);
  const vmin = Math.min(0, ...view.map((m) => {
    var _a2;
    return (_a2 = valueOf(m)) != null ? _a2 : 0;
  }));
  const f = frame(width, height, scale.max, vmin, scale.steps);
  const colW = (f.plot.right - f.plot.left) / N;
  const barW = Math.min(28, colW * 0.46);
  const cx = (i) => f.plot.left + i * colW + colW / 2;
  const bars = view.map((m, i) => {
    const v = valueOf(m);
    const top = v === void 0 ? f.zeroY : f.y(Math.max(0, v));
    const bottom = v === void 0 ? f.zeroY : f.y(Math.min(0, v));
    return {
      key: m,
      label: `${Number(m.slice(5))}月`,
      x: cx(i) - barW / 2,
      width: barW,
      y: top,
      height: Math.max(bottom - top, v ? 2 : 0),
      value: v != null ? v : null,
      tone: m === opts.selected ? "selected" : v === void 0 ? "future" : v < 0 ? "loss" : m === current ? "current" : "normal"
    };
  });
  const line = view.map((m, i) => ({ v: valueOf(m), x: cx(i) })).filter((p) => p.v !== void 0).map((p) => ({ x: p.x, y: f.y(p.v) }));
  const tgt = view.map((m, i) => ({ v: targetBy.get(m), x: cx(i) })).filter((p) => p.v !== void 0).map((p) => ({ x: p.x, y: f.y(p.v) }));
  return {
    width,
    height,
    plot: f.plot,
    ticks: f.ticks,
    zeroY: f.zeroY,
    bars,
    line,
    target: tgt,
    canPrev: start > 0,
    canNext: start < maxStart,
    start,
    note: `目标：${PROFIT_TARGET.endMonth.replace("-", " 年 ")} 月利润 ¥${axisMoney(PROFIT_TARGET.endProfit)}`
  };
}
function bucketBarsLayout(opts) {
  const { buckets, width, height } = opts;
  const peak = Math.max(...buckets.map((b) => Math.abs(b.profit)), 1);
  const scale = niceScale(peak * 1.12);
  const anyNeg = buckets.some((b) => b.profit < 0);
  const vmin = anyNeg ? -scale.max : 0;
  const f = frame(width, height, scale.max, vmin, anyNeg ? 4 : scale.steps);
  const colW = (f.plot.right - f.plot.left) / Math.max(buckets.length, 1);
  const barW = Math.min(26, colW * 0.5);
  const bars = buckets.map((b, i) => {
    const top = f.y(Math.max(0, b.profit));
    const bottom = f.y(Math.min(0, b.profit));
    return {
      key: b.key,
      label: b.label,
      x: f.plot.left + i * colW + colW / 2 - barW / 2,
      width: barW,
      y: top,
      height: Math.max(bottom - top, b.count ? 2 : 0),
      value: b.profit,
      tone: b.key === opts.selected ? "selected" : b.profit < 0 ? "loss" : i === buckets.length - 1 ? "current" : "normal"
    };
  });
  return { width, height, plot: f.plot, ticks: f.ticks, zeroY: f.zeroY, bars, line: [], target: [], canPrev: false, canNext: false, start: 0, note: "" };
}
function productBarsLayout(products, width) {
  const top = Math.max(...products.map((p) => p.profit), 1);
  const track = width - 4;
  const rows = products.map((p, i) => ({
    rank: "0" + (i + 1),
    name: p.name,
    profit: p.profit,
    count: p.count,
    y: 8 + i * 52,
    width: Math.max(Math.max(0, p.profit) / top * track, p.profit > 0 ? 6 : 0),
    first: i === 0
  }));
  return { width, height: Math.max(60, 16 + products.length * 52), rows };
}
function hitBar(layout, x) {
  let best = null;
  let dist = Infinity;
  for (const b of layout.bars) {
    const d = Math.abs(b.x + b.width / 2 - x);
    if (d < dist) {
      dist = d;
      best = b;
    }
  }
  const colW = layout.bars.length ? (layout.plot.right - layout.plot.left) / layout.bars.length : 0;
  return best && dist <= colW / 2 + 1 ? best : null;
}
var FONT = "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif";
function roundTop(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, Math.PI * 1.5, Math.PI * 2);
  ctx.lineTo(x + w, y + h);
  ctx.fill();
}
function drawChart(ctx, l) {
  const C = CHART_COLORS;
  ctx.clearRect(0, 0, l.width, l.height);
  ctx.font = `10px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  for (const t of l.ticks) {
    ctx.strokeStyle = C.grid;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(l.plot.left, t.y);
    ctx.lineTo(l.plot.right, t.y);
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.textAlign = "right";
    ctx.fillText(t.label, l.plot.left - 6, t.y);
  }
  for (const b of l.bars) {
    ctx.fillStyle = b.tone === "selected" ? C.selected : b.tone === "loss" ? C.loss : b.tone === "current" ? C.coral : b.tone === "future" ? C.grid : C.coralSoft;
    if (b.height > 0) {
      if (b.value !== null && b.value < 0) ctx.fillRect(b.x, b.y, b.width, b.height);
      else roundTop(ctx, b.x, b.y, b.width, b.height, 5);
    }
    ctx.fillStyle = b.tone === "current" || b.tone === "selected" ? C.ink : C.muted;
    ctx.textAlign = "center";
    ctx.fillText(b.label, b.x + b.width / 2, l.plot.bottom + 14);
  }
  if (l.target.length) {
    ctx.strokeStyle = C.target;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    l.target.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (l.line.length) {
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    l.line.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
    ctx.fillStyle = C.ink;
    for (const p of l.line) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function drawProductBars(ctx, l, money2) {
  const C = CHART_COLORS;
  ctx.clearRect(0, 0, l.width, l.height);
  ctx.textBaseline = "middle";
  for (const r of l.rows) {
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillStyle = C.muted;
    ctx.fillText(r.rank, 0, r.y + 8);
    ctx.fillStyle = C.ink;
    ctx.font = `13px ${FONT}`;
    ctx.fillText(r.name.length > 14 ? r.name.slice(0, 13) + "…" : r.name, 24, r.y + 8);
    ctx.textAlign = "right";
    ctx.font = `600 13px ${FONT}`;
    ctx.fillText(`¥${money2(r.profit)}`, l.width, r.y + 8);
    ctx.fillStyle = C.grid;
    ctx.fillRect(0, r.y + 22, l.width - 4, 10);
    ctx.fillStyle = r.first ? C.coral : C.coralSoft;
    if (r.width > 0) ctx.fillRect(0, r.y + 22, r.width, 10);
    ctx.fillStyle = C.muted;
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(`${r.count} 笔`, 0, r.y + 42);
  }
}

// src/miniapp/view.ts
var OFFSET = 8 * 36e5;
function beijingInput(iso = (/* @__PURE__ */ new Date()).toISOString()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + OFFSET).toISOString().slice(0, 16) : "";
}
var beijingDay = (iso) => beijingInput(iso).slice(0, 10);
function beijingToUTC(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("请选择有效的北京时间");
  const time = Date.parse(`${value}:00+08:00`);
  if (!Number.isFinite(time) || beijingInput(new Date(time).toISOString()) !== value) throw new Error("请选择有效的北京时间");
  return new Date(time).toISOString();
}
function requestId(random = defaultRandom) {
  const bytes = random(16);
  return "mp-" + Array.from(bytes, (b) => (b & 255).toString(16).padStart(2, "0")).join("");
}
function defaultRandom(n) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 256));
}
var yuan = (cents) => "¥" + money(cents);
function totalsText(t) {
  return { revenue: yuan(t.revenue), cost: yuan(t.cost), profit: yuan(t.profit), count: t.count, loss: t.profit < 0 };
}
function homeView(d, ranking, day = today()) {
  const month = d.month;
  return {
    day,
    monthTitle: `${Number(day.slice(5, 7))} 月利润`,
    monthProfit: yuan(month.profit),
    monthLoss: month.profit < 0,
    stats: [
      { label: "本月销售额", value: yuan(month.revenue) },
      { label: "本月成本", value: yuan(month.cost) },
      { label: "本月成交", value: `${month.count} 笔` }
    ],
    quick: [
      { label: "今天", value: yuan(d.today.profit), loss: d.today.profit < 0 },
      { label: "本周", value: yuan(d.week.profit), loss: d.week.profit < 0 },
      { label: "累计", value: yuan(d.all.profit), loss: d.all.profit < 0 }
    ],
    hasProducts: d.products.length > 0,
    ranking: rankingRows(ranking)
  };
}
function rankingRows(r, limit = 5) {
  if (!r) return [];
  return r.items.slice(0, limit).map((c) => {
    var _a;
    return {
      id: c.customerId,
      rank: c.rank,
      name: displayCustomerName(c.name),
      profit: yuan(c.totals.profit),
      count: c.totals.count,
      pending: c.pendingTaskCount,
      top: ((_a = c.products[0]) == null ? void 0 : _a.name) || ""
    };
  });
}
function trendSummary(buckets, selected) {
  const hit = buckets.find((b) => b.key === selected || b.key.slice(0, 7) === selected);
  const sum = buckets.reduce(
    (a, b) => ({ profit: a.profit + b.profit, revenue: a.revenue + b.revenue, cost: a.cost + b.cost, count: a.count + b.count }),
    { profit: 0, revenue: 0, cost: 0, count: 0 }
  );
  const t = hit || sum;
  return {
    range: hit ? `${hit.from} 至 ${hit.to}` : "所选时段利润",
    profit: yuan(t.profit),
    detail: `${t.count} 笔 · 收入 ${yuan(t.revenue)} · 成本 ${yuan(t.cost)}`,
    from: (hit == null ? void 0 : hit.from) || "",
    to: (hit == null ? void 0 : hit.to) || ""
  };
}
function freshDraft(date = today(), id = requestId()) {
  return { requestId: id, productId: "", productName: "", customer: "", date, revenue: "", cost: "", note: "" };
}
function draftFromSale(s, id = requestId()) {
  return __spreadValues({
    requestId: id,
    productId: s.productId,
    productName: s.productName,
    customer: s.customer,
    date: s.date,
    dateTouched: true,
    revenue: moneyInput(s.revenue),
    cost: moneyInput(s.cost),
    note: s.note
  }, s.paidBy ? { paidBy: s.paidBy } : {});
}
function draftDirty(d, day = today()) {
  return Boolean(d.productName || d.customer || d.revenue || d.cost || d.note || d.date !== day);
}
function pickProduct(d, p) {
  return __spreadProps(__spreadValues({}, d), {
    productId: p.id,
    productName: p.name,
    revenue: p.hasDefaultPrice === false ? "" : moneyInput(p.price),
    cost: p.hasDefaultCost === false ? "" : moneyInput(p.cost)
  });
}
function draftProfit(d, edit) {
  try {
    return yuan(parseYuan(d.revenue, edit == null ? void 0 : edit.revenue) - parseYuan(d.cost, edit == null ? void 0 : edit.cost));
  } catch (e) {
    return "¥ —";
  }
}
function productGroups(products) {
  return groupProducts(products.filter((p) => p.active && !p.archivedAt));
}
function prepareSave(d, opts = {}) {
  var _a, _b;
  const sale = __spreadValues({
    productId: d.productId,
    productName: d.productName,
    customer: d.customer,
    date: d.date,
    revenue: parseYuan(d.revenue, (_a = opts.edit) == null ? void 0 : _a.revenue),
    cost: parseYuan(d.cost, (_b = opts.edit) == null ? void 0 : _b.cost),
    note: d.note
  }, opts.payerOn && d.paidBy ? { paidBy: d.paidBy } : {});
  let schedule;
  if (!opts.edit && d.schedule) {
    const wall = d.scheduleDate && d.scheduleTime ? `${d.scheduleDate}T${d.scheduleTime}` : defaultFollowUp(d.date);
    const customer = d.customer.trim();
    if (!customer) throw new Error("新增客户日程需要先填写客户名称");
    if (inLunchBreak(wall)) throw new Error("12:30–14:00 不排日程，请换个时间");
    schedule = __spreadProps(__spreadValues({
      customer,
      at: beijingToUTC(wall)
    }, scheduleText(d.scheduleTitle || "", d.productName, [])), {
      reminder: d.scheduleReminder || "both",
      requestId: d.scheduleRequestId || requestId()
    });
  }
  return { sale, schedule };
}
function scheduleDefaults(d) {
  const wall = defaultFollowUp(d.date);
  return { scheduleDate: d.scheduleDate || wall.slice(0, 10), scheduleTime: d.scheduleTime || wall.slice(11) };
}
function customerRootByName(list, name) {
  var _a;
  const hit = findCustomerByName(list, name, displayCustomerName);
  if (!hit) return null;
  const byId = new Map(list.map((c) => [c.id, c]));
  let id = hit.id;
  const seen = /* @__PURE__ */ new Set();
  while (((_a = byId.get(id)) == null ? void 0 : _a.mergedInto) && !seen.has(id)) {
    seen.add(id);
    id = byId.get(id).mergedInto;
  }
  return id;
}
function customerHints(names, input, n = 8) {
  const q = input.trim().toLocaleLowerCase();
  if (!q) return [];
  return names.filter((c) => c.toLocaleLowerCase().includes(q) && c !== input.trim()).slice(0, n);
}
function presetRange(p, day = today()) {
  if (p === "today") return { from: day, to: day };
  if (p === "week") {
    const w = (/* @__PURE__ */ new Date(day + "T00:00:00Z")).getUTCDay();
    const from = addDays(day, -((w + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  if (p === "month") {
    const from = day.slice(0, 7) + "-01";
    return { from, to: lastDay(from) };
  }
  if (p === "lastMonth") {
    const from = shiftMonth(day.slice(0, 7), -1) + "-01";
    return { from, to: lastDay(from) };
  }
  return {};
}
function lastDay(first) {
  return addDays(shiftMonth(first.slice(0, 7), 1) + "-01", -1);
}
function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + m - 1 + n;
  return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`;
}
function cleanFilters(f) {
  const out = {};
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.productId) out.productId = f.productId;
  if (f.search && f.search.trim()) out.search = f.search.trim();
  if (f.deleted) out.deleted = true;
  out.page = Math.max(1, Math.floor(f.page || 1));
  return out;
}
function canEdit(sale, me) {
  return me.role === "admin" || !!sale.createdBy && sale.createdBy === me.uid;
}
function saleRow(s, me) {
  const profit = s.revenue - s.cost;
  return {
    id: s.id,
    revision: s.revision,
    date: s.date.slice(5).replace("-", "/"),
    product: s.productName,
    customer: displayCustomerName(s.customer),
    note: s.note,
    revenue: yuan(s.revenue),
    cost: yuan(s.cost),
    profit: yuan(profit),
    loss: profit < 0,
    editable: canEdit(s, me),
    deleted: !!s.deletedAt
  };
}
function pageInfo(total, page, size = 30) {
  const pages = Math.max(1, Math.ceil(total / size));
  return { pages, page: Math.min(page, pages), hasPrev: page > 1, hasNext: page < pages, text: `第 ${Math.min(page, pages)} / ${pages} 页 · 共 ${total} 笔` };
}
function taskStatus(t, now = Date.now()) {
  if (t.deletedAt) return "已删除";
  if (t.completedAt) return "已完成";
  if (Date.parse(t.at) < now) return "已逾期";
  const day = beijingDay(new Date(now).toISOString());
  const at = beijingDay(t.at);
  return at === day ? "今日待办" : at === addDays(day, 1) ? "明日待办" : "待办";
}
function taskRow(t, customers, now = Date.now()) {
  const wall = beijingInput(t.at);
  const status = taskStatus(t, now);
  return {
    id: t.id,
    revision: t.revision,
    time: wall.slice(11),
    date: `${Number(wall.slice(5, 7))}月${Number(wall.slice(8, 10))}日`,
    short: `${Number(wall.slice(5, 7))}/${Number(wall.slice(8, 10))}`,
    customer: displayCustomerName(customers.get(t.customerId) || "未知客户"),
    title: t.title,
    nextAction: t.nextAction,
    status,
    tone: status === "已逾期" ? "late" : status === "已完成" ? "done" : status === "已删除" ? "gone" : "todo",
    done: !!t.completedAt,
    deleted: !!t.deletedAt
  };
}
function customerNames(list) {
  return new Map(list.map((c) => [c.id, c.name]));
}
function monthGrid(month, tasks, selected, day = today()) {
  const first = month + "-01";
  const w = (/* @__PURE__ */ new Date(first + "T00:00:00Z")).getUTCDay();
  const start = addDays(first, -((w + 6) % 7));
  const byDay = /* @__PURE__ */ new Map();
  for (const t of tasks) {
    if (t.deletedAt) continue;
    const d = beijingDay(t.at);
    const c = byDay.get(d) || { open: 0, done: 0 };
    if (t.completedAt) c.done++;
    else c.open++;
    byDay.set(d, c);
  }
  const weeks = Array.from(
    { length: 6 },
    (_, r) => Array.from({ length: 7 }, (_2, c) => {
      const date = addDays(start, r * 7 + c);
      const n = byDay.get(date) || { open: 0, done: 0 };
      return {
        date,
        num: Number(date.slice(8)),
        inMonth: date.startsWith(month),
        today: date === day,
        selected: date === selected,
        open: n.open,
        done: n.done
      };
    })
  );
  return { title: `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`, weeks: weeks.filter((wk, i) => i < 5 || wk.some((d) => d.inMonth)) };
}
function monthRange(month) {
  const from = month + "-01";
  return { from, to: lastDay(from) };
}
function agenda(tasks, day = today(), now = Date.now()) {
  const live = tasks.filter((t) => !t.deletedAt);
  const sorted = sortTasksTodayFirst(live, day);
  return {
    today: sorted.filter((t) => beijingDay(t.at) === day),
    tomorrow: sorted.filter((t) => beijingDay(t.at) === addDays(day, 1)),
    overdue: sorted.filter((t) => !t.completedAt && Date.parse(t.at) < now && beijingDay(t.at) < day)
  };
}
function bell(tasks, day = today()) {
  const rows = dailyPendingTasks(tasks, day);
  return { count: rows.length, badge: rows.length > 99 ? "99+" : rows.length ? String(rows.length) : "", rows };
}
var REMINDERS = [
  { value: "both", label: "提前 + 到点提醒" },
  { value: "due", label: "只在到点提醒" },
  { value: "off", label: "不提醒" }
];
function freshTask(date = today(), id = requestId()) {
  return { customerId: "", customerName: "", date, time: "10:00", title: "", nextAction: "", feedback: "", reminder: "both", requestId: id };
}
function draftFromTask(t, customers, id = requestId()) {
  const wall = beijingInput(t.at);
  return {
    customerId: t.customerId,
    customerName: displayCustomerName(customers.get(t.customerId) || ""),
    date: wall.slice(0, 10),
    time: wall.slice(11),
    title: t.title,
    nextAction: t.nextAction,
    feedback: t.feedback,
    reminder: t.reminder,
    requestId: id
  };
}
function taskInput(d) {
  if (!d.customerId) throw new Error("请选择客户");
  if (!d.title.trim()) throw new Error("请填写日程标题");
  const wall = `${d.date}T${d.time}`;
  if (inLunchBreak(wall)) throw new Error("12:30–14:00 不排日程，请换个时间");
  return {
    customerId: d.customerId,
    at: beijingToUTC(wall),
    title: d.title.trim(),
    feedback: d.feedback,
    nextAction: d.nextAction,
    reminder: d.reminder
  };
}

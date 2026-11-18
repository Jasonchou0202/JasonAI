/**
 * 小程序首页两张图（Canvas 2D）：利润走势（每月 = 利润目标图；每日/每周 = 柱状图）、本月商品贡献。
 * 坐标、刻度、目标线全部来自 domain（profitTarget / finance），和网页算出来的数一致；
 * 这里只把数算成「画什么、画在哪」，再用一个只依赖 Canvas 2D 标准接口的 draw 函数画出来，
 * 所以小程序 canvas type="2d" 和浏览器预览用的是同一段绘图代码。
 */
import type { Bucket } from "../domain/model";
import { PROFIT_TARGET, addMonth, anchorMonth, fixedTarget, monthDiff } from "../domain/profitTarget";

export const CHART_COLORS = {
  coral: "#D97757",
  coralSoft: "#F2C6B4",
  loss: "#9E2A1E",
  ink: "#2B2522",
  muted: "#8A7B70",
  grid: "#EFE7E0",
  target: "#B4532F",
  selected: "#B4532F",
};

/** 金额刻度文字：≥1 万元写「x万」，否则整数元 */
export function axisMoney(cents: number) {
  const y = cents / 1_000_000;
  if (Math.abs(y) >= 1) return `${+y.toFixed(2)}万`;
  return String(Math.round(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/** 好看的刻度上限（与网页 ProfitTargetChart 同一张表） */
export function niceScale(v: number): { max: number; steps: number } {
  if (v <= 0) return { max: 1000_00, steps: 4 };
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const opts: [number, number][] = [[1, 4], [1.2, 4], [1.5, 5], [2, 4], [2.5, 5], [3, 3], [4, 4], [5, 5], [6, 3], [8, 4], [10, 4]];
  const [m, steps] = opts.find(([m]) => m * p >= v)!;
  return { max: m * p, steps };
}

export interface ChartBar {
  key: string;
  label: string;
  x: number;
  width: number;
  y: number;
  height: number;
  value: number | null;
  /** 0 = 普通，1 = 当前（本月/今天），2 = 选中 */
  tone: "normal" | "current" | "selected" | "loss" | "future";
}
export interface ChartLayout {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  ticks: { y: number; label: string }[];
  zeroY: number;
  bars: ChartBar[];
  /** 实际利润折线（只到本月） */
  line: { x: number; y: number }[];
  /** 目标虚线 */
  target: { x: number; y: number }[];
  /** 可以往前/往后翻 */
  canPrev: boolean;
  canNext: boolean;
  start: number;
  /** 目标说明，例如「目标：2027-12 月利润 ¥10万」 */
  note: string;
}

function frame(width: number, height: number, vmax: number, vmin: number, steps: number) {
  const plot = { left: 44, right: width - 6, top: 18, bottom: height - 26 };
  const y = (v: number) => plot.top + ((vmax - v) / (vmax - vmin || 1)) * (plot.bottom - plot.top);
  const ticks = Array.from({ length: steps + 1 }, (_, i) => {
    const v = vmax - (i * (vmax - vmin)) / steps;
    return { y: y(v), label: axisMoney(v) };
  });
  return { plot, y, ticks, zeroY: y(0) };
}

/** 每月利润目标图：默认窗口 = 本月前 2 个月 + 之后，共 visibleMonths 个月；start 由翻页决定 */
export function profitTargetLayout(opts: {
  months: Bucket[];
  current: string;
  startProfit?: number | null;
  width: number;
  height: number;
  /** 窗口起点下标；不传 = 默认窗口 */
  start?: number;
  selected?: string;
}): ChartLayout | null {
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
  const start = Math.min(maxStart, Math.max(0, opts.start ?? fallback));
  const view = all.slice(start, start + N);
  const valueOf = (m: string) => (m <= current ? actual.get(m)?.profit : undefined);
  // 不用 flatMap：老基础库（iOS 11 及以下）没有
  const scale = niceScale(Math.max(...view.map((m) => Math.max(valueOf(m) ?? 0, targetBy.get(m) ?? 0))) * 1.12);
  const vmin = Math.min(0, ...view.map((m) => valueOf(m) ?? 0));
  const f = frame(width, height, scale.max, vmin, scale.steps);
  const colW = (f.plot.right - f.plot.left) / N;
  const barW = Math.min(28, colW * 0.46);
  const cx = (i: number) => f.plot.left + i * colW + colW / 2;
  const bars: ChartBar[] = view.map((m, i) => {
    const v = valueOf(m);
    const top = v === undefined ? f.zeroY : f.y(Math.max(0, v));
    const bottom = v === undefined ? f.zeroY : f.y(Math.min(0, v));
    return {
      key: m,
      label: `${Number(m.slice(5))}月`,
      x: cx(i) - barW / 2,
      width: barW,
      y: top,
      height: Math.max(bottom - top, v ? 2 : 0),
      value: v ?? null,
      tone: m === opts.selected ? "selected" : v === undefined ? "future" : v < 0 ? "loss" : m === current ? "current" : "normal",
    };
  });
  const line = view
    .map((m, i) => ({ v: valueOf(m), x: cx(i) }))
    .filter((p): p is { v: number; x: number } => p.v !== undefined)
    .map((p) => ({ x: p.x, y: f.y(p.v) }));
  const tgt = view
    .map((m, i) => ({ v: targetBy.get(m), x: cx(i) }))
    .filter((p): p is { v: number; x: number } => p.v !== undefined)
    .map((p) => ({ x: p.x, y: f.y(p.v) }));
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
    note: `目标：${PROFIT_TARGET.endMonth.replace("-", " 年 ")} 月利润 ¥${axisMoney(PROFIT_TARGET.endProfit)}`,
  };
}

/** 每日 / 每周利润柱（最近 7 天 / 8 周），最后一根是当前 */
export function bucketBarsLayout(opts: { buckets: Bucket[]; width: number; height: number; selected?: string }): ChartLayout {
  const { buckets, width, height } = opts;
  const peak = Math.max(...buckets.map((b) => Math.abs(b.profit)), 1);
  const scale = niceScale(peak * 1.12);
  const anyNeg = buckets.some((b) => b.profit < 0);
  const vmin = anyNeg ? -scale.max : 0;
  const f = frame(width, height, scale.max, vmin, anyNeg ? 4 : scale.steps);
  const colW = (f.plot.right - f.plot.left) / Math.max(buckets.length, 1);
  const barW = Math.min(26, colW * 0.5);
  const bars = buckets.map((b, i): ChartBar => {
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
      tone: b.key === opts.selected ? "selected" : b.profit < 0 ? "loss" : i === buckets.length - 1 ? "current" : "normal",
    };
  });
  return { width, height, plot: f.plot, ticks: f.ticks, zeroY: f.zeroY, bars, line: [], target: [], canPrev: false, canNext: false, start: 0, note: "" };
}

/** 本月商品贡献：横向条（前 5），条长按最大正利润 */
export interface ProductBar {
  rank: string;
  name: string;
  profit: number;
  count: number;
  y: number;
  width: number;
  first: boolean;
}
export function productBarsLayout(products: { name: string; profit: number; count: number }[], width: number) {
  const top = Math.max(...products.map((p) => p.profit), 1);
  const track = width - 4;
  const rows: ProductBar[] = products.map((p, i) => ({
    rank: "0" + (i + 1),
    name: p.name,
    profit: p.profit,
    count: p.count,
    y: 8 + i * 52,
    width: Math.max((Math.max(0, p.profit) / top) * track, p.profit > 0 ? 6 : 0),
    first: i === 0,
  }));
  return { width, height: Math.max(60, 16 + products.length * 52), rows };
}

/** 点到哪根柱（按横坐标找最近的列） */
export function hitBar(layout: ChartLayout, x: number): ChartBar | null {
  let best: ChartBar | null = null;
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

/** Canvas 2D 最小接口：小程序 canvas 2d 和浏览器 canvas 都满足 */
export interface Ctx2D {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a: number, b: number): void;
  stroke(): void;
  fill(): void;
  fillText(t: string, x: number, y: number): void;
  setLineDash(s: number[]): void;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
}
const FONT = "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif";
function roundTop(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
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
export function drawChart(ctx: Ctx2D, l: ChartLayout) {
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
    ctx.fillStyle =
      b.tone === "selected" ? C.selected : b.tone === "loss" ? C.loss : b.tone === "current" ? C.coral : b.tone === "future" ? C.grid : C.coralSoft;
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
    l.target.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (l.line.length) {
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    l.line.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.fillStyle = C.ink;
    for (const p of l.line) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
export function drawProductBars(ctx: Ctx2D, l: ReturnType<typeof productBarsLayout>, money: (v: number) => string) {
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
    ctx.fillText(`¥${money(r.profit)}`, l.width, r.y + 8);
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

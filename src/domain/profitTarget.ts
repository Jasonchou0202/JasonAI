/** 利润目标参数：改这里即可调整目标走势 */
export const PROFIT_TARGET = {
  /** 目标终点月份 */
  endMonth: "2027-12",
  /** 终点月利润（分）：¥100,000 */
  endProfit: 100_000_00,
  /** 目标起点月份（固定）：用这个月的实际利润作为起点，不随当前月份变化 */
  startMonth: "2026-09",
  /** 默认可见月数（半年）：本月前 monthsBefore 个月 + 本月 + 之后的月份，其余用滑杆切换 */
  visibleMonths: 6,
  monthsBefore: 2,
};

export function addMonth(month: string, n: number): string {
  let [y, m] = month.split("-").map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/**
 * 目标走势（线性，每月等额增加）：起点 = startMonth 的实际利润，终点 = endMonth 的 endProfit。
 */
export function targetSeries(
  startMonth: string,
  startProfit: number,
  endMonth = PROFIT_TARGET.endMonth,
  endProfit = PROFIT_TARGET.endProfit,
) {
  const n = monthDiff(startMonth, endMonth);
  if (n <= 0) return { points: [{ month: endMonth, value: endProfit }], step: 0 };
  const step = (endProfit - startProfit) / n;
  const points = Array.from({ length: n + 1 }, (_, i) => ({
    month: addMonth(startMonth, i),
    value: Math.round(startProfit + step * i),
  }));
  return { points, step };
}

/** 按固定起点（PROFIT_TARGET.startMonth）从月度数据算目标线；与当前月份无关 */
export function fixedTarget(months: { key: string; profit: number }[], startProfit?: number | null) {
  const start = PROFIT_TARGET.startMonth;
  // 优先使用后端返回的固定起点利润；拿不到再退回到从月度数据里找
  if (typeof startProfit === "number" && Number.isFinite(startProfit))
    return { startMonth: start, hasStart: true, ...targetSeries(start, startProfit) };
  const startBucket = months.find((b) => b.key.slice(0, 7) === start);
  // 找不到起点利润（例如已不在返回的月份数据里）时，不从 0 画线，只保留终点目标
  if (!startBucket)
    return { startMonth: start, hasStart: false, points: [{ month: PROFIT_TARGET.endMonth, value: PROFIT_TARGET.endProfit }], step: 0 };
  return { startMonth: start, hasStart: true, ...targetSeries(start, startBucket.profit) };
}

/** 窗口锚点月份：过了终点月后停在终点月 */
export function anchorMonth(current: string) {
  return current > PROFIT_TARGET.endMonth ? PROFIT_TARGET.endMonth : current;
}

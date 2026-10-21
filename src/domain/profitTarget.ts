/** 利润目标参数：改这里即可调整目标走势 */
export const PROFIT_TARGET = {
  /** 目标终点月份 */
  endMonth: "2027-12",
  /** 终点月利润（分）：¥100,000 */
  endProfit: 100_000_00,
  /** 目标曲线：linear = 每月等额增加；compound = 每月按固定增长率 */
  curve: "linear" as "linear" | "compound",
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
 * 目标走势：起点 = 最近一个完整月（本月的上一个月）的实际利润，终点 = endMonth 的 endProfit。
 * compound 在起点 ≤ 0 时无法计算增长率，自动改用 linear。
 */
export function targetSeries(
  startMonth: string,
  startProfit: number,
  curve = PROFIT_TARGET.curve,
  endMonth = PROFIT_TARGET.endMonth,
  endProfit = PROFIT_TARGET.endProfit,
) {
  const n = monthDiff(startMonth, endMonth);
  if (n <= 0) return { points: [{ month: endMonth, value: endProfit }], step: 0, rate: 0, curve };
  const useCompound = curve === "compound" && startProfit > 0;
  const step = (endProfit - startProfit) / n;
  const rate = useCompound ? Math.pow(endProfit / startProfit, 1 / n) - 1 : 0;
  const points = Array.from({ length: n + 1 }, (_, i) => ({
    month: addMonth(startMonth, i),
    value: Math.round(useCompound ? startProfit * Math.pow(1 + rate, i) : startProfit + step * i),
  }));
  return { points, step, rate, curve: useCompound ? "compound" : "linear" };
}

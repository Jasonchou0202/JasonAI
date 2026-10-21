import { useEffect, useRef, useState } from "react";
import type { Bucket } from "../domain/model";
import { money } from "../domain/finance";
import { PROFIT_TARGET, addMonth, monthDiff, targetSeries } from "../domain/profitTarget";

/** 每月利润：实际柱 + 实际走势线 + 目标虚线（延伸到 2027-12） */
export function ProfitTargetChart({ months, current }: { months: Bucket[]; current: string }) {
  // 预览用：localStorage 里 zhangyuge-profit-target-curve=compound 时显示方案 B
  const curve = (typeof localStorage !== "undefined" && localStorage.getItem("zhangyuge-profit-target-curve") === "compound") ? "compound" : PROFIT_TARGET.curve;
  const first = months[0].key.slice(0, 7);
  const startMonth = addMonth(current, -1);
  const actual = new Map(months.map((b) => [b.key.slice(0, 7), b]));
  const target = targetSeries(startMonth, actual.get(startMonth)?.profit ?? 0, curve);
  const targetBy = new Map(target.points.map((p) => [p.month, p.value]));
  const all = Array.from({ length: monthDiff(first, PROFIT_TARGET.endMonth) + 1 }, (_, i) => addMonth(first, i));
  const [sel, setSel] = useState<string>(current);
  const scroller = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(720);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth || 720));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 220, top = 26, bottom = 30, left = 46, right = 8;
  // 默认可见半年：最近 5 个完整月 + 本月，其余左右滑动查看
  const W = Math.max(24, (cw - left - right) / PROFIT_TARGET.visibleMonths);
  const width = left + all.length * W + right;
  const bw = Math.min(36, W * 0.45);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, x(all.indexOf(current)) + W / 2 + right - el.clientWidth);
  }, [cw]);
  const max = Math.max(PROFIT_TARGET.endProfit, ...months.map((b) => b.profit)) * 1.08;
  const min = Math.min(0, ...months.map((b) => b.profit));
  const y = (v: number) => top + ((max - v) / (max - min)) * (H - top - bottom);
  const x = (i: number) => left + i * W + W / 2;
  const actualPts = all.map((m, i) => (m <= current && actual.has(m) ? `${x(i)},${y(actual.get(m)!.profit)}` : null)).filter(Boolean);
  const targetPts = all.map((m, i) => (targetBy.has(m) ? `${x(i)},${y(targetBy.get(m)!)}` : null)).filter(Boolean);
  const ticks = [0, 25_000_00, 50_000_00, 75_000_00, 100_000_00];
  const a = actual.get(sel)?.profit, t = targetBy.get(sel);
  const endI = all.indexOf(PROFIT_TARGET.endMonth);
  return (
    <div className="profit-target">
      <div className="pt-legend">
        <span><i className="lg-bar" />实际利润（柱）</span>
        <span><i className="lg-line" />实际利润走势（线）</span>
        <span><i className="lg-dash" />目标走势（虚线）</span>
      </div>
      <div className="pt-readout" aria-live="polite">
        <b>{sel.replace("-", " 年 ")} 月</b>
        <span>实际 {a !== undefined && sel <= current ? `¥${money(a)}` : "—"}</span>
        <span>目标 {t !== undefined ? `¥${money(t)}` : "—"}</span>
        {a !== undefined && t !== undefined && sel <= current && (
          <span className={a - t >= 0 ? "pt-ok" : "pt-gap"}>{a - t >= 0 ? "超出" : "差距"} ¥{money(Math.abs(a - t))}</span>
        )}
      </div>
      <div className="pt-frame">
      <svg className="pt-yaxis" width={left} height={H} aria-hidden="true">
        {ticks.map((v) => <text key={v} x={left - 8} y={y(v) + 4} className="pt-ytick">{v ? `${v / 1_000_000}万` : "0"}</text>)}
      </svg>
      <div className="pt-scroll" ref={scroller}>
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`每月利润与目标走势，目标 ${PROFIT_TARGET.endMonth} 达到每月 ¥${money(PROFIT_TARGET.endProfit)}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left - 4} x2={width - 8} y1={y(v)} y2={y(v)} className="pt-grid" />
            </g>
          ))}
          {all.map((m, i) => {
            const b = m <= current ? actual.get(m) : undefined;
            return (
              <g key={m} className={`pt-col ${sel === m ? "sel" : ""}`} onMouseEnter={() => setSel(m)} onClick={() => setSel(m)}>
                <rect x={x(i) - W / 2} y={top} width={W} height={H - top - bottom} className="pt-hit" />
                {b && <rect x={x(i) - bw / 2} width={bw} y={Math.min(y(b.profit), y(0))} height={Math.max(Math.abs(y(b.profit) - y(0)), b.count ? 2 : 0)} rx={4} className={`pt-bar ${m === current ? "cur" : ""} ${b.profit < 0 ? "loss" : ""}`} />}
                {(W >= 40 || m.endsWith("-01") || i % 3 === 0) && (
                  <text x={x(i)} y={H - 12} className="pt-xtick">{m.endsWith("-01") || i === 0 ? `${m.slice(2, 4)}年${Number(m.slice(5))}月` : `${Number(m.slice(5))}月`}</text>
                )}
              </g>
            );
          })}
          <polyline points={targetPts.join(" ")} className="pt-target" />
          <polyline points={actualPts.join(" ")} className="pt-actual" />
          {endI >= 0 && (
            <g className="pt-end">
              <circle cx={x(endI)} cy={y(PROFIT_TARGET.endProfit)} r={5} />
              <text x={x(endI) + W / 2 - 2} y={y(PROFIT_TARGET.endProfit) - 10}>{PROFIT_TARGET.endMonth.replace("-", ".")} ¥10万</text>
            </g>
          )}
        </svg>
      </div>
      </div>
      <p className="pt-note">
        目标从 {startMonth.replace("-", " 年 ")} 月实际利润起，{target.curve === "compound" ? `每月增长 ${(target.rate * 100).toFixed(1)}%` : `每月增加约 ¥${money(Math.round(target.step))}`}，到 {PROFIT_TARGET.endMonth.replace("-", " 年 ")} 月达到 ¥{money(PROFIT_TARGET.endProfit)}
      </p>
    </div>
  );
}

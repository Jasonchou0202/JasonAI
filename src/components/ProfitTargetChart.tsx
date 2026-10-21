import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Bucket } from "../domain/model";
import { money } from "../domain/finance";
import { PROFIT_TARGET, addMonth, monthDiff, targetSeries } from "../domain/profitTarget";

const wan = (v: number) => {
  const y = v / 1_000_000;
  return y >= 1 ? `${+y.toFixed(2)}万` : `${Math.round(v / 100).toLocaleString("zh-CN")}`;
};
/** 好看的刻度上限：1/2/2.5/5 × 10^n */
function niceScale(v: number): { max: number; steps: number } {
  if (v <= 0) return { max: 1000_00, steps: 4 };
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const opts: [number, number][] = [[1, 4], [1.2, 4], [1.5, 5], [2, 4], [2.5, 5], [3, 3], [4, 4], [5, 5], [6, 3], [8, 4], [10, 4]];
  const [m, steps] = opts.find(([m]) => m * p >= v)!;
  return { max: m * p, steps };
}

/** 每月利润：实际柱 + 实际走势线 + 目标虚线；默认显示本月前 2 个月到后 3 个月，下方滑杆切换 */
export function ProfitTargetChart({ months, current }: { months: Bucket[]; current: string }) {
  // 预览用：localStorage 里 zhangyuge-profit-target-curve=compound 时显示方案 B
  const curve = typeof localStorage !== "undefined" && localStorage.getItem("zhangyuge-profit-target-curve") === "compound" ? "compound" : PROFIT_TARGET.curve;
  const first = months[0].key.slice(0, 7);
  const startMonth = addMonth(current, -1);
  const actual = new Map(months.map((b) => [b.key.slice(0, 7), b]));
  const target = targetSeries(startMonth, actual.get(startMonth)?.profit ?? 0, curve);
  const targetBy = new Map(target.points.map((p) => [p.month, p.value]));
  const all = Array.from({ length: monthDiff(first, PROFIT_TARGET.endMonth) + 1 }, (_, i) => addMonth(first, i));
  const N = Math.min(PROFIT_TARGET.visibleMonths, all.length);
  const maxStart = all.length - N;
  const curI = all.indexOf(current);
  const [start, setStart] = useState(Math.min(maxStart, Math.max(0, curI - PROFIT_TARGET.monthsBefore)));
  const [sel, setSel] = useState(current);
  const box = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth || 720));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sliderId = useId();
  const narrow = cw < 560;
  const H = narrow ? 260 : 320, top = 30, bottom = 30, left = narrow ? 40 : 52, right = 8;
  const view = all.slice(start, start + N);
  const valueOf = (m: string) => (m <= current ? actual.get(m)?.profit : undefined);
  const scale = niceScale(Math.max(...view.flatMap((m) => [valueOf(m) ?? 0, targetBy.get(m) ?? 0])) * 1.12);
  const vmax = scale.max;
  const vmin = Math.min(0, ...view.map((m) => valueOf(m) ?? 0));
  const plotH = H - top - bottom;
  const y = (v: number) => top + ((vmax - v) / (vmax - vmin)) * plotH;
  const colW = (cw - left - right) / N;
  const x = (i: number) => left + i * colW + colW / 2;
  const bw = Math.min(56, colW * 0.56);
  const ticks = Array.from({ length: scale.steps + 1 }, (_, k) => (vmax / scale.steps) * k);
  const line = (pick: (m: string) => number | undefined) =>
    view.map((m, i) => { const v = pick(m); return v === undefined ? null : `${x(i)},${y(v)}`; }).filter(Boolean).join(" ");
  const a = valueOf(sel), t = targetBy.get(sel);
  const curActual = actual.get(current)?.profit ?? 0, curTarget = targetBy.get(current);
  const pctMonth = curTarget ? Math.round((curActual / curTarget) * 100) : 0;
  const pctEnd = Math.round((curActual / PROFIT_TARGET.endProfit) * 1000) / 10;
  const endLabel = PROFIT_TARGET.endMonth.replace("-", ".");
  const go = (s: number) => setStart(Math.max(0, Math.min(maxStart, s)));
  return (
    <div className="profit-target">
      <div className="pt-progress" role="status">
        <span>距 {endLabel} 月利 {wan(PROFIT_TARGET.endProfit)} 目标：</span>
        <b>本月完成 {pctMonth}%</b>
        <small>（本月实际 ¥{money(curActual)} ÷ 本月目标 ¥{money(curTarget ?? 0)}）</small>
        <span className="pt-progress-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, pctEnd)}%` }} /></span>
        <small>已达终点目标 {pctEnd}%（本月实际 ÷ ¥{money(PROFIT_TARGET.endProfit)}）</small>
      </div>
      <div className="pt-legend">
        <span><i className="lg-bar" />实际利润（柱）</span>
        <span><i className="lg-line" />实际利润走势（线）</span>
        <span><i className="lg-dash" />目标走势（虚线）</span>
      </div>
      <div className="pt-readout" aria-live="polite">
        <b>{sel.replace("-", " 年 ")} 月</b>
        <span>实际 {a !== undefined ? `¥${money(a)}` : "—"}</span>
        <span>目标 {t !== undefined ? `¥${money(t)}` : "—"}</span>
        {a !== undefined && t !== undefined && (
          <span className={a - t >= 0 ? "pt-ok" : "pt-gap"}>{a - t >= 0 ? "超出" : "差距"} ¥{money(Math.abs(a - t))}</span>
        )}
      </div>
      <div className="pt-box" ref={box}>
        <svg width={cw} height={H} viewBox={`0 0 ${cw} ${H}`} role="img" aria-label={`每月利润与目标走势，${endLabel} 目标每月 ¥${money(PROFIT_TARGET.endProfit)}`}>
          <defs>
            <linearGradient id="ptBlue" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#2997FF" />
              <stop offset="1" stopColor="#0066CC" />
            </linearGradient>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left} x2={cw - right} y1={y(v)} y2={y(v)} className="pt-grid" />
              <text x={left - 8} y={y(v) + 4} className="pt-ytick">{wan(v)}</text>
            </g>
          ))}
          {view.map((m, i) => {
            const v = valueOf(m), tv = targetBy.get(m);
            const future = m > current;
            const h = v === undefined ? 0 : Math.abs(y(v) - y(0));
            const r = Math.min(8, bw / 2, h);
            const bx = x(i) - bw / 2, by = Math.min(y(v ?? 0), y(0));
            return (
              <g key={m} className={`pt-col ${sel === m ? "sel" : ""}`} onMouseEnter={() => setSel(m)} onClick={() => setSel(m)}>
                <rect x={x(i) - colW / 2} y={top} width={colW} height={plotH} className="pt-hit" />
                {v !== undefined && h > 0 && (
                  <path className={`pt-bar ${m === current ? "cur" : ""} ${v < 0 ? "loss" : ""}`}
                    d={v >= 0
                      ? `M${bx},${by + h} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + bw - r} Q${bx + bw},${by} ${bx + bw},${by + r} V${by + h} Z`
                      : `M${bx},${by} H${bx + bw} V${by + h} H${bx} Z`} />
                )}
                {v !== undefined && <text x={x(i)} y={y(Math.max(v, 0)) - 6} className="pt-val">{wan(v)}</text>}
                {future && tv !== undefined && (
                  <>
                    <rect x={bx} y={y(tv)} width={bw} height={y(0) - y(tv)} rx={Math.min(8, bw / 2)} className="pt-ghost" />
                    {m !== PROFIT_TARGET.endMonth && <text x={x(i)} y={y(tv) - 6} className="pt-val target">目标 {wan(tv)}</text>}
                  </>
                )}
                <text x={x(i)} y={H - 10} className={`pt-xtick ${m === current ? "cur" : ""}`}>
                  {i === 0 || m.endsWith("-01") ? `${m.slice(2, 4)}年${Number(m.slice(5))}月` : `${Number(m.slice(5))}月`}
                </text>
              </g>
            );
          })}
          <polyline points={line((m) => targetBy.get(m))} className="pt-target" />
          <polyline points={line(valueOf)} className="pt-actual" />
          {view.includes(PROFIT_TARGET.endMonth) && (() => {
            const i = view.indexOf(PROFIT_TARGET.endMonth);
            return (
              <g className="pt-end">
                <circle cx={x(i)} cy={y(PROFIT_TARGET.endProfit)} r={6} />
                <text x={x(i) + colW / 2 - 4} y={y(PROFIT_TARGET.endProfit) - 12}>{endLabel} 目标 ¥10万</text>
              </g>
            );
          })()}
        </svg>
      </div>
      <div className="pt-slider">
        <button type="button" className="icon-button" aria-label="往前一个月" disabled={start === 0} onClick={() => go(start - 1)}><ChevronLeft size={16} /></button>
        <label htmlFor={sliderId} className="sr-only">选择显示的月份范围</label>
        <input id={sliderId} type="range" min={0} max={maxStart} value={start} onChange={(e) => go(Number(e.target.value))}
          aria-valuetext={`${view[0]} 至 ${view.at(-1)}`} style={{ ["--p" as string]: `${maxStart ? (start / maxStart) * 100 : 0}%` }} />
        <button type="button" className="icon-button" aria-label="往后一个月" disabled={start === maxStart} onClick={() => go(start + 1)}><ChevronRight size={16} /></button>
        <small>{view[0].replace("-", ".")} – {view.at(-1)!.replace("-", ".")}</small>
        {start !== Math.min(maxStart, Math.max(0, curI - PROFIT_TARGET.monthsBefore)) && (
          <button type="button" className="text-button" onClick={() => go(curI - PROFIT_TARGET.monthsBefore)}>回到本月</button>
        )}
      </div>
      <p className="pt-note">
        目标从 {startMonth.replace("-", " 年 ")} 月实际利润起，{target.curve === "compound" ? `每月增长 ${(target.rate * 100).toFixed(1)}%` : `每月增加约 ¥${money(Math.round(target.step))}`}，到 {PROFIT_TARGET.endMonth.replace("-", " 年 ")} 月达到 ¥{money(PROFIT_TARGET.endProfit)}
      </p>
    </div>
  );
}

import { useState } from "react";
import { LineChart, BarChart3 } from "lucide-react";
import {
  QUADRANTS, QUADRANT_INFO, NEW_RULE_TEXT, monthlyNewCustomers, monthlyQuadrantCustomers, pct,
} from "../domain/insights";
import { useInsights } from "../lib/insights-ui";
import { treemap } from "../lib/treemap";

const mLabel = (m: string) => `${Number(m.slice(5))}月`;

/** 每月新进客户数（按首次购买月份）折线图 */
export function NewCustomerTrend() {
  const { sales, customers, insights } = useInsights();
  const [hover, setHover] = useState<number | null>(null);
  if (!insights) return null;
  const rows = monthlyNewCustomers(sales, customers);
  if (!rows.length) return null;
  const W = 640, H = 200, P = 28;
  const max = Math.max(...rows.map((r) => r.count), 1);
  const x = (i: number) => P + (rows.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (rows.length - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const path = rows.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r.count)}`).join(" ");
  const shown = hover ?? rows.length - 1;
  return (
    <section className="panel monthly-chart" aria-labelledby="new-cust-title">
      <div className="panel-heading">
        <div>
          <h2 id="new-cust-title"><LineChart size={17} /> 每月新增客户走势</h2>
          <p>每月新进客户数（按首次购买月份，合并后的客户只算一次）</p>
        </div>
        <div className="chart-readout" aria-live="polite">
          <span>{rows[shown].month.replace("-", " 年 ")} 月</span>
          <strong>{rows[shown].count} 位</strong>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="line-svg" role="img" aria-label={"每月新进客户数：" + rows.map((r) => `${mLabel(r.month)}${r.count}位`).join("，")}>
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="axis" />
        <path d={`${path} L${x(rows.length - 1)},${H - P} L${x(0)},${H - P} Z`} className="area" />
        <path d={path} className="line" />
        {rows.map((r, i) => (
          <g key={r.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
            <rect x={x(i) - 16} y={0} width={32} height={H} fill="transparent" />
            <circle cx={x(i)} cy={y(r.count)} r={i === shown ? 5 : 3.5} className="dot" />
            <text x={x(i)} y={y(r.count) - 10} className="val">{r.count}</text>
            <text x={x(i)} y={H - 8} className="lab">{mLabel(r.month)}</text>
          </g>
        ))}
      </svg>
    </section>
  );
}

/** 默认显示的月份数（含本月） */
export const QUAD_WINDOW = 3;
/** 每月四色块客户数与占比：每月一张树状图，格子面积 = 该色块客户数；默认近 3 个月，拖滑块看其他月份 */
export function MonthlyQuadrantChart() {
  const { sales, insights } = useInsights();
  const rows = insights ? monthlyQuadrantCustomers(sales, insights) : [];
  const last = Math.max(rows.length - 1, 0);
  const [end, setEnd] = useState<number | null>(null);
  if (!insights || !rows.length) return null;
  const at = Math.min(end ?? last, last);
  const shown = rows.slice(Math.max(0, at - QUAD_WINDOW + 1), at + 1);
  const minEnd = Math.min(QUAD_WINDOW - 1, last);
  const dot = (m: string) => m.replace("-", ".");
  return (
    <section className="panel monthly-chart quad-treemap-panel" aria-labelledby="quad-month-title">
      <div className="panel-heading">
        <div>
          <h2 id="quad-month-title"><BarChart3 size={17} /> 每月四色块客户数与占比</h2>
          <p>格子大小 = 该色块客户数；占比 = 该色块客户数 ÷ 当月成交客户数。一位客户同月可落在两个色块，所以四项相加可能超过 100%；{NEW_RULE_TEXT}</p>
        </div>
      </div>
      <div className="quad-legend">
        {QUADRANTS.map((q) => <span key={q}><i style={{ background: QUADRANT_INFO[q].color }} />{QUADRANT_INFO[q].label}</span>)}
      </div>
      <div className="quad-treemaps" data-months={shown.map((r) => r.month).join(",")}>
        {shown.map((r) => {
          const cells = treemap(QUADRANTS.map((q) => ({ item: q, value: r.counts[q] })));
          return (
            <figure key={r.month} className="quad-treemap-month">
              <figcaption><strong>{dot(r.month)}</strong><small>{r.active} 位客户</small></figcaption>
              <div className="quad-treemap" role="img" aria-label={`${r.month}：` + QUADRANTS.map((q) => `${QUADRANT_INFO[q].short}${r.counts[q]}位（${pct(r.counts[q], r.active)}%）`).join("，")}>
                {cells.length ? cells.map((c) => {
                  const info = QUADRANT_INFO[c.item];
                  const tiny = c.w < 22 || c.h < 22;
                  return (
                    <span key={c.item} className={`quad-tm-cell ${tiny ? "tiny" : ""}`} data-quadrant={c.item}
                      style={{ left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%`, background: info.color }}
                      title={`${info.label}：${c.value} 位，占当月 ${pct(c.value, r.active)}%`}>
                      {!tiny && <em>{info.short}</em>}
                      <b>{c.value}<small>位</small></b>
                      {!tiny && <small>{pct(c.value, r.active)}%</small>}
                    </span>
                  );
                }) : <span className="quad-tm-empty">当月无成交</span>}
              </div>
              <ul className="quad-tm-nums">
                {QUADRANTS.map((q) => (
                  <li key={q} className={r.counts[q] ? "" : "zero"}>
                    <i style={{ background: r.counts[q] ? QUADRANT_INFO[q].color : undefined }} />
                    {QUADRANT_INFO[q].short} {r.counts[q]}位 · {pct(r.counts[q], r.active)}%
                  </li>
                ))}
              </ul>
            </figure>
          );
        })}
      </div>
      {last > minEnd && (
        <div className="quad-slider">
          <span>{dot(rows[0].month)}</span>
          <input
            type="range"
            min={minEnd}
            max={last}
            step={1}
            value={at}
            aria-label="选择显示的月份"
            aria-valuetext={`${dot(shown[0].month)} 至 ${dot(shown.at(-1)!.month)}`}
            onChange={(e) => setEnd(Number(e.target.value))}
          />
          <span>{dot(rows[last].month)}</span>
          <strong aria-live="polite">{dot(shown[0].month)} – {dot(shown.at(-1)!.month)}</strong>
        </div>
      )}
    </section>
  );
}

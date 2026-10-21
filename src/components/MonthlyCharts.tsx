import { useState } from "react";
import { LineChart, BarChart3 } from "lucide-react";
import {
  QUADRANTS, QUADRANT_INFO, NEW_RULE_TEXT, monthlyNewCustomers, monthlyQuadrantCustomers, pct,
} from "../domain/insights";
import { useInsights } from "../lib/insights-ui";

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

/** 每月四色块客户数与占比：堆叠条 + 数字 */
export function MonthlyQuadrantChart() {
  const { sales, insights } = useInsights();
  if (!insights) return null;
  const rows = monthlyQuadrantCustomers(sales, insights);
  if (!rows.length) return null;
  return (
    <section className="panel monthly-chart" aria-labelledby="quad-month-title">
      <div className="panel-heading">
        <div>
          <h2 id="quad-month-title"><BarChart3 size={17} /> 每月四色块客户数与占比</h2>
          <p>占比 = 该色块客户数 ÷ 当月成交客户数。一位客户同月可落在两个色块，所以四项相加可能超过 100%；{NEW_RULE_TEXT}</p>
        </div>
      </div>
      <div className="quad-legend">
        {QUADRANTS.map((q) => <span key={q}><i style={{ background: QUADRANT_INFO[q].color }} />{QUADRANT_INFO[q].label}</span>)}
      </div>
      <ol className="quad-months">
        {[...rows].reverse().map((r) => {
          const slots = QUADRANTS.reduce((n, q) => n + r.counts[q], 0);
          return (
            <li key={r.month}>
              <span className="qm-month">{r.month.replace("-", ".")}<small>{r.active} 位客户</small></span>
              <span className="qm-bar" role="img" aria-label={`${r.month}：` + QUADRANTS.map((q) => `${QUADRANT_INFO[q].short}${r.counts[q]}位（${pct(r.counts[q], r.active)}%）`).join("，")}>
                {slots ? QUADRANTS.filter((q) => r.counts[q]).map((q) => (
                  <i key={q} style={{ width: `${(r.counts[q] / slots) * 100}%`, background: QUADRANT_INFO[q].color }}
                    title={`${QUADRANT_INFO[q].label}：${r.counts[q]} 位，占当月 ${pct(r.counts[q], r.active)}%`} />
                )) : <i className="empty" style={{ width: "100%" }} />}
              </span>
              <span className="qm-nums">
                {QUADRANTS.map((q) => (
                  <small key={q} className={r.counts[q] ? "" : "zero"}>
                    <b style={{ background: r.counts[q] ? QUADRANT_INFO[q].color : undefined }} />
                    {r.counts[q]}位 {pct(r.counts[q], r.active)}%
                  </small>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

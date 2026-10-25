import { useState } from "react";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import type { Api } from "../domain/model";
import { money } from "../domain/finance";
import { today } from "../domain/dates";
import { QUADRANT_INFO, NEW_RULE_TEXT, quadrantTotals, type Quadrant } from "../domain/insights";
import { apiMode } from "../lib/customer-ui";
import { useActionLibrary, useInsights } from "../lib/insights-ui";

type Range = "month" | "quarter" | "year";
const RANGES: { id: Range; label: string }[] = [
  { id: "month", label: "本月" },
  { id: "quarter", label: "本季度" },
  { id: "year", label: "本年" },
];
/** 北京时间的自然月 / 季度 / 年起始日（today() 已按北京时间取日期） */
export function rangeStart(day: string, range: Range): string {
  const [y, m] = day.split("-").map(Number);
  if (range === "year") return `${y}-01-01`;
  if (range === "quarter") return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  return day.slice(0, 7) + "-01";
}
// 按附件布局：上排新客户，下排老客户；左列老产品，右列新产品
const GRID: Quadrant[] = ["newOld", "newNew", "oldOld", "oldNew"];

export function QuadrantMatrix({ api }: { api: Api }) {
  const { insights, sales } = useInsights();
  const { actions } = useActionLibrary(apiMode(api));
  const [range, setRange] = useState<Range>("month");
  if (!insights) return null;
  const day = today();
  const from = rangeStart(day, range);
  const rows = sales.filter((s) => !s.deletedAt && s.date >= from && s.date <= day);
  const t = quadrantTotals(rows, insights.quadrantOf);
  return (
    <section className="panel quad-panel" aria-labelledby="quad-title">
      <div className="panel-heading">
        <div>
          <h2 id="quad-title"><LayoutGrid size={17} /> 客户 × 产品矩阵</h2>
          <p>{NEW_RULE_TEXT}；灰色象限是待开拓的增长方向</p>
        </div>
        <div className="period-tabs" role="tablist" aria-label="矩阵周期">
          {RANGES.map((r) => (
            <button key={r.id} role="tab" aria-selected={range === r.id} className={range === r.id ? "selected" : ""} onClick={() => setRange(r.id)}>{r.label}</button>
          ))}
        </div>
      </div>
      <div className="quad-wrap">
        <div className="quad-matrix">
          <div className="qx-yaxis" aria-hidden="true"><span className="qx-arrow-up" /><b>Y轴 · 客户</b><span className="qx-yline" /></div>
          {GRID.map((q, i) => {
            const info = QUADRANT_INFO[q], v = t[q], on = v.count > 0;
            const hints = actions.filter((a) => a.quadrant === q).slice(0, 2);
            return [
              i % 2 === 0 && <span key={"y" + i} className="qx-ylab">{i === 0 ? "新客户" : "老客户"}</span>,
              <div key={q} className={`quad-cell ${on ? "on" : "empty"}`} style={on ? { ["--qc" as string]: info.color } : undefined} data-quadrant={q}>
                <span className="quad-name">{info.label}</span>
                {on ? (
                  <>
                    <strong>{v.count} 笔</strong>
                    <small>销售额 ¥{money(v.revenue)}</small>
                    <small>纯利 ¥{money(v.profit)}</small>
                  </>
                ) : (
                  <>
                    <strong className="quad-todo"><i style={{ background: info.color }} />待开拓</strong>
                    {hints.map((a) => <small key={a.id} className="quad-hint">· {a.text}</small>)}
                    <a className="quad-link" href={`#/calendar?actions=${q}`}>有效动作 · 加入日程 <ArrowUpRight size={12} /></a>
                  </>
                )}
              </div>,
            ];
          })}
          <span className="qx-xlab qx-c1">老产品</span>
          <span className="qx-xlab qx-c2">新产品</span>
          <div className="qx-xaxis" aria-hidden="true"><b>X轴 · 产品</b><span className="qx-arrow-right" /></div>
        </div>
      </div>
    </section>
  );
}

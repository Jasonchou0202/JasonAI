import { ClipboardList } from "lucide-react";
import { needShares } from "../domain/profile";
import { useInsights } from "../lib/insights-ui";

/** 客户需求占比：分母为记录了至少一项需求的客户数（合并后的客户只算一次） */
export function NeedShareChart() {
  const { customers, insights } = useInsights();
  if (!insights) return null;
  const { total, rows } = needShares(customers.filter((c) => !c.mergedInto && !c.archivedAt).map((c) => c.profile));
  return (
    <section className="panel need-chart" aria-labelledby="need-title">
      <div className="panel-heading">
        <div>
          <h2 id="need-title"><ClipboardList size={17} /> 客户需求占比</h2>
          <p>占比 = 有该需求的客户数 ÷ 已记录需求的客户数（{total} 位）；一位客户可有多项需求，相加可能超过 100%</p>
        </div>
      </div>
      {rows.length ? (
        <ol className="need-rows">
          {rows.map((r) => (
            <li key={r.need}>
              <span className="need-name">{r.need}</span>
              <span className="need-bar"><i style={{ width: `${r.pct}%` }} /></span>
              <span className="need-num">{r.count} 位 · {r.pct}%</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="need-empty">还没有客户记录需求。在客户详情的「客户画像」里勾选需求后，这里会显示占比。</p>
      )}
    </section>
  );
}

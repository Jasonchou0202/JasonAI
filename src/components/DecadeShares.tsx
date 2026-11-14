import type { Api } from "../domain/model";
import type { DecadeSettlement } from "../domain/expenses";
import { PROFIT_SHARE_HINT } from "../domain/expenses";
import { money } from "../domain/finance";
import { useQuery } from "./ui";
import "../expenses.css";

function titleOf(row: DecadeSettlement) {
  const m = Number(row.decade.from.slice(5, 7));
  if (row.decade.index === 0) return `${m}月 1–10 日`;
  if (row.decade.index === 1) return `${m}月 11–20 日`;
  return `${m}月 21–月末`;
}

export function DecadeShares({
  api,
  version,
  onOpen,
}: {
  api: Api;
  version: number;
  onOpen: () => void;
}) {
  const { data } = useQuery<{ items: DecadeSettlement[]; today: string }>(
    api,
    "expenses.shares",
    {},
    version,
  );
  if (!data?.items?.length) return null;
  return (
    <section className="exp-shares" aria-label="十天应得利润">
      <div className="exp-shares-head">
        <div>
          <h2>十天应得利润</h2>
          <p className="exp-shares-desc">只看当前这一段和后面两段，按实际利润六四分成。合账明细在报销记账。</p>
          <p className="exp-shares-desc-short">当前段与后两段，按实际利润六四分。</p>
        </div>
        <button type="button" className="exp-shares-link" onClick={onOpen}>
          查看报销记账 →
        </button>
      </div>
      <div className="exp-share-grid">
        {data.items.map((row) => {
          const upcoming = row.phase === "upcoming";
          const phase = row.phase === "closed" ? "已出账" : row.phase === "current" ? "进行中" : "待出账 · 示意";
          return (
            <article className={`exp-share-card ${row.phase === "current" ? "current" : ""}`} key={row.decade.from}>
              <header>
                <span>{titleOf(row)}</span>
                <span className={`exp-phase ${row.phase}`}>{phase}</span>
              </header>
              {!row.sharesOpen ? (
                <p className="exp-share-wait">{PROFIT_SHARE_HINT}</p>
              ) : (
                <>
                  <div className="exp-share-row">
                    <span>{row.owner.name} 60%</span>
                    {upcoming ? <span className="dash">—</span> : <b>¥{money(row.owner.amount)}</b>}
                  </div>
                  <div className="exp-share-row">
                    <span>{row.partner.name} 40%</span>
                    {upcoming ? <span className="dash">—</span> : <b>¥{money(row.partner.amount)}</b>}
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

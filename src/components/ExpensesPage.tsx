import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Api } from "../domain/model";
import type { DecadeSettlement, MonthCompare, Expense, MonthSettlement } from "../domain/expenses";
import { EXPENSE_STATUS_LABEL, PROFIT_SHARE_HINT, shiftMonth } from "../domain/expenses";
import { money } from "../domain/finance";
import { today } from "../domain/dates";
import { useTeam } from "../lib/team-ui";
import { ErrorNote, useQuery } from "./ui";
import "../expenses.css";

interface SettlementPayload extends MonthSettlement {
  compare: MonthCompare[];
  details: (Expense & { payerName: string })[];
  people: { owner: { uid: string; name: string }; partner: { uid: string; name: string } };
  today: string;
}

function slashDate(date: string) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function phaseLabel(phase: DecadeSettlement["phase"]) {
  return phase === "closed" ? "已出账" : phase === "current" ? "进行中" : "待出账 · 示意";
}

function yenOrDash(value: number, upcoming: boolean) {
  return upcoming ? "—" : `¥${money(value)}`;
}

function DecadeCard({ row, admin }: { row: DecadeSettlement; admin: boolean }) {
  const upcoming = row.phase === "upcoming";
  const hideShares = upcoming || !row.sharesOpen;
  const phaseLabel = row.phase === "closed" ? "已出账" : row.phase === "current" ? "进行中" : "待出账 · 示意";
  const n = (v: number) => (upcoming ? "—" : `¥${money(v)}`);
  const share = (v: number) => (hideShares ? "—" : `¥${money(v)}`);
  return (
    <article className={`exp-card ${row.phase === "current" ? "current" : ""}`}>
      <div className="exp-card-head">
        <div>
          <h2>{row.decade.shortLabel}</h2>
          <p className="exp-sub">实际利润</p>
        </div>
        <span className={`exp-phase ${row.phase}`}>{phaseLabel}</span>
      </div>
      <div className={`exp-profit ${hideShares ? "muted" : ""}`}>
        {upcoming ? "尚未有数" : row.sharesOpen ? `¥${money(row.profit)}` : "尚未分成"}
      </div>
      <div className="exp-grid">
        <div>
          <span>销售收入</span>
          <b>{n(row.revenue)}</b>
        </div>
        <div>
          <span>进货成本</span>
          <b>{n(row.cost)}</b>
          {!upcoming && <small>来自销售记录</small>}
        </div>
        <div>
          <span>报销成本</span>
          <b>{n(row.expense)}</b>
        </div>
        <div>
          <span>总成本</span>
          <b>{n(row.totalCost)}</b>
        </div>
      </div>
      <hr className="exp-hr" />
      <div className="exp-kv">
        <div className="exp-row"><span>六四分账</span><span /></div>
        <div className="exp-row"><span>{row.owner.name} 60%</span><b>{share(row.owner.amount)}</b></div>
        <div className="exp-row"><span>{row.partner.name} 40%</span><b>{share(row.partner.amount)}</b></div>
      </div>
      <hr className="exp-hr" />
      <div className="exp-kv">
        <div className="exp-row"><span>本段垫付</span><span /></div>
        <div className="exp-row"><span>{row.owner.name}垫付</span><b>{share(row.owner.advance)}</b></div>
        <div className="exp-row"><span>{row.partner.name}垫付</span><b>{share(row.partner.advance)}</b></div>
      </div>
      {upcoming ? (
        <div className="exp-hint upcoming">本段未出账，不做结算</div>
      ) : !row.sharesOpen ? (
        <div className="exp-hint upcoming">{PROFIT_SHARE_HINT}</div>
      ) : admin ? (
        <div className="exp-hint">
          <em>结算提示</em>
          <span>{row.partner.name}应收回 ¥{money(row.partnerReceive)}</span>
        </div>
      ) : (
        <div className="exp-hint upcoming">成员只看自己的报销，结算以管理员账本为准</div>
      )}
    </article>
  );
}

function CompareChart({ rows, today }: { rows: MonthCompare[]; today: string }) {
  const peak = Math.max(...rows.flatMap((r) => [r.salesProfit, r.profit]), 100);
  return (
    <div className="exp-compare" aria-label="利润对照图">
      {rows.map((r) => {
        const salesH = Math.max((Math.max(0, r.salesProfit) / peak) * 100, r.salesProfit > 0 ? 4 : 0);
        const actualH = Math.max((Math.max(0, r.profit) / peak) * 100, r.profit > 0 ? 4 : 0);
        return (
          <div className="exp-compare-col" key={r.month}>
            <div className="exp-compare-bars">
              <span className="sales" style={{ height: `${salesH}%` }} title={`只算销售 ${money(r.salesProfit)}`} />
              <span className="actual" style={{ height: `${actualH}%` }} title={`实际利润 ${money(r.profit)}`} />
            </div>
            <small>{Number(r.month.slice(5, 7))}月</small>
          </div>
        );
      })}
    </div>
  );
}

export function ExpensesPage({
  api,
  version,
  month,
  onMonth,
  onNew,
  onPending,
}: {
  api: Api;
  version: number;
  month: string;
  onMonth: (month: string) => void;
  onNew: () => void;
  onPending: () => void;
}) {
  const { me } = useTeam();
  const admin = me.role === "admin";
  const { data, error, loading } = useQuery<SettlementPayload>(
    api,
    "expenses.settlement",
    { month },
    version,
  );
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || loading) return <p className="subtle">正在打开报销记账…</p>;
  const [y, m] = month.split("-");
  const postedFrom = data.decades.find((d) => d.phase !== "upcoming")?.decade.from;
  const postedTo = [...data.decades].reverse().find((d) => d.phase !== "upcoming")?.decade.to;
  const booked = data.details.filter((d) => d.status === "pending_reimburse" || d.status === "reimbursed");
  const pending = data.details.filter((d) => d.status === "pending_confirm");
  return (
    <div className="exp-page">
      <div className="exp-heading">
        <div>
          <h1>报销记账</h1>
          <p className="exp-lead-full">
            十天合账与报销明细都在这里。实际利润 = 销售收入（来自销售记录，不必在此重复记）− 进货成本 − 报销成本。分账按{data.people.owner.name} 60%、{data.people.partner.name} 40%。示例按销售收入记在{data.people.owner.name}处结算。
          </p>
          <p className="exp-lead-short">十天合账。分账按{data.people.owner.name} 60%、{data.people.partner.name} 40%。</p>
        </div>
        <div className="exp-heading-actions">
          <div className="exp-month-nav" aria-label="切换月份">
            <button type="button" aria-label="上个月" onClick={() => onMonth(shiftMonth(month, -1))}>
              <ChevronLeft size={16} />
            </button>
            <strong>{y} 年 {Number(m)} 月</strong>
            <button type="button" aria-label="下个月" onClick={() => onMonth(shiftMonth(month, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
          <button type="button" className="exp-cta" onClick={onNew}>
            <Plus size={16} />
            记一笔报销
          </button>
        </div>
      </div>
      <section className="exp-overview" aria-label="本月三段全貌">
        {data.decades.map((row) => {
          const upcoming = row.phase === "upcoming";
          const hideShares = upcoming || !row.sharesOpen;
          return (
            <article className={`exp-overview-row ${row.phase}`} key={row.decade.from}>
              <header>
                <h3>{row.decade.label}</h3>
                <span className={`exp-phase ${row.phase}`}>{phaseLabel(row.phase)}</span>
                <b className={hideShares ? "muted" : ""}>{hideShares ? "—" : `¥${money(row.profit)}`}</b>
              </header>
              {row.sharesOpen ? (
                <p>
                  <span>{row.owner.name} 60% {yenOrDash(row.owner.amount, upcoming)}</span>
                  <span>{row.partner.name} 40% {yenOrDash(row.partner.amount, upcoming)}</span>
                  {admin && <span>{row.partner.name}应收回 {yenOrDash(row.partnerReceive, upcoming)}</span>}
                </p>
              ) : (
                <p className="exp-share-wait">{PROFIT_SHARE_HINT}</p>
              )}
            </article>
          );
        })}
        {admin && (
          <div className="exp-overview-total">
            <strong>已出账合计</strong>
            {data.posted.sharesOpen ? (
              <>
                <span>实际利润 ¥{money(data.posted.profit)}</span>
                <span>{data.people.partner.name}应收回 ¥{money(data.posted.partnerReceive)}</span>
              </>
            ) : (
              <span>{PROFIT_SHARE_HINT}</span>
            )}
          </div>
        )}
      </section>
      <p className="exp-details-jump">下滑查看各段明细与报销清单</p>
      <div className="exp-decades">
        {data.decades.map((row) => (
          <DecadeCard key={row.decade.from} row={row} admin={admin} />
        ))}
      </div>
      {admin && (
        <section className="exp-posted" aria-label="已出账合计">
          <div className="exp-posted-title">
            <small>
              {y} 年 {Number(m)} 月
              {postedFrom && postedTo ? ` · ${slashDate(postedFrom)}–${slashDate(postedTo)}` : ""}
            </small>
            <b>已出账合计</b>
          </div>
          <div className="exp-posted-metrics">
            <div><span>销售收入</span><b>¥{money(data.posted.revenue)}</b></div>
            <div><span>进货成本</span><b>¥{money(data.posted.cost)}</b></div>
            <div><span>报销成本</span><b>¥{money(data.posted.expense)}</b></div>
            <div><span>总成本</span><b>¥{money(data.posted.totalCost)}</b></div>
            <div><span>实际利润</span><b>¥{money(data.posted.profit)}</b></div>
            <div>
              <span>六四分账</span>
              <b style={{ fontSize: "0.95rem", fontWeight: 650 }}>
                {data.people.owner.name} 60%　¥{money(data.posted.owner.amount)}
                <br />
                {data.people.partner.name} 40%　¥{money(data.posted.partner.amount)}
              </b>
            </div>
          </div>
          <div className="exp-posted-hint">
            {postedFrom && postedTo ? `${slashDate(postedFrom)}–${slashDate(postedTo)} 日结算提示` : "结算提示"}
            <div>{data.people.partner.name}应收回 ¥{money(data.posted.partnerReceive)}</div>
            <small>
              垫付 ¥{money(data.posted.partner.advance)} + 四成利润 ¥{money(data.posted.partner.amount)}
              {data.decades.some((d) => d.phase === "upcoming") ? " · 未出账段未计入" : ""}
            </small>
          </div>
        </section>
      )}
      <div className="exp-lower">
        <section className="exp-panel">
          <h2>利润对照</h2>
          <p className="exp-lead">近 {data.compare.length} 个月对照。{month === today().slice(0, 7) && data.compare.some((c) => c.partial) ? `${Number(m)} 月只记已出账或进行中的段。` : ""}</p>
          <div className="exp-legend">
            <span><i className="sales" />只算销售的利润</span>
            <span><i className="actual" />扣成本后的实际利润</span>
          </div>
          <CompareChart rows={data.compare} today={data.today} />
          <p className="exp-compare-note">
            {Number(m)} 月{data.compare.find((c) => c.month === month)?.partial ? "按已记账的段合计" : "整月合计"}
            （只算销售 ¥{money(data.posted.salesProfit)}，扣成本后 ¥{money(data.posted.profit)}）
            {data.decades.some((d) => d.phase === "upcoming") ? "；未出账段未计入。" : "。"}
          </p>
        </section>
        <section className="exp-panel">
          <div className="exp-table-head">
            <div>
              <h2>本月报销明细</h2>
              <p className="exp-lead">
                已入账 {booked.length} 笔，合计 ¥{money(booked.reduce((n, r) => n + r.amount, 0))}。
                {pending.length > 0 ? `待确认 ${pending.length} 笔尚未入账，不计入合账。` : ""}
              </p>
            </div>
            {admin && pending.length > 0 && (
              <button type="button" className="exp-pending-tag" onClick={onPending}>
                待你确认 {pending.length} 笔
              </button>
            )}
          </div>
          {data.details.length === 0 ? (
            <p className="subtle">这个月还没有报销记录。</p>
          ) : (
            <>
            <table className="exp-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>分类</th>
                  <th>谁出</th>
                  <th className="num">金额</th>
                  <th>发票</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {data.details.map((row) => (
                  <tr key={row.id}>
                    <td>{slashDate(row.date)}</td>
                    <td>{row.categoryName}</td>
                    <td>{row.payerName}</td>
                    <td className="num">¥{money(row.amount)}</td>
                    <td>{row.hasInvoice ? "有" : "无"}</td>
                    <td>
                      <span className={`exp-status ${row.status}`}>{EXPENSE_STATUS_LABEL[row.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="exp-detail-cards">
              {data.details.map((row) => (
                <li key={row.id} className="exp-detail-card">
                  <div className="exp-detail-top">
                    <strong>{row.categoryName}</strong>
                    <b>¥{money(row.amount)}</b>
                  </div>
                  <div className="exp-detail-meta">
                    <span>{slashDate(row.date)}</span>
                    <span>{row.payerName}</span>
                    <span>{row.hasInvoice ? "有发票" : "无发票"}</span>
                    <span className={`exp-status ${row.status}`}>{EXPENSE_STATUS_LABEL[row.status]}</span>
                  </div>
                  {row.note ? <p className="exp-detail-note">{row.note}</p> : null}
                </li>
              ))}
            </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

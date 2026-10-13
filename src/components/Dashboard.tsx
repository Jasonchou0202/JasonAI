import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Plus,
  TrendingUp,
  Wallet,
  ReceiptText,
} from "lucide-react";
import type {
  Api,
  Dashboard as Data,
  Period,
  Filters,
  Sale,
  Bucket,
} from "../domain/model";
import { money, totals } from "../domain/finance";
import { today, periodRange } from "../domain/dates";
import { useQuery, ErrorNote, Loading, Money, Empty, SaleRows } from "./ui";
import { CustomerRanking } from "./CustomerRanking";
export function Dashboard({
  api,
  version,
  onFilter,
  onNew,
  onEdit,
  onCustomer,
}: {
  api: Api;
  version: number;
  onFilter: (f: Filters) => void;
  onNew: () => void;
  onEdit: (r: Sale) => void;
  onCustomer: (id: string, month: string) => void;
}) {
  const { data, error, loading } = useQuery<Data>(
    api,
    "dashboard",
    {},
    version,
  );
  const [period, setPeriod] = useState<Period>("day");
  const [hover, setHover] = useState<Bucket | null>(null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || loading) return <Loading />;
  const chart =
    period === "day" ? data.days : period === "week" ? data.weeks : data.months;
  const chartTotal = {
    ...totals(chart),
    count: chart.reduce((n, b) => n + b.count, 0),
  };
  const peak = Math.max(...chart.map((b) => Math.abs(b.profit)), 100);
  const anyNegative = chart.some((b) => b.profit < 0);
  const go = (p: Period) => onFilter(periodRange(today(), p));
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">每一笔生意，都心中有数</p>
          <h1>
            生意概览
            <span className="heading-dot" />
          </h1>
          <p className="subtle">
            {today().replaceAll("-", " / ")}
            <span className="heading-divider">|</span>看看最近的收获
          </p>
        </div>
        <button className="button primary heading-add" onClick={onNew}>
          <Plus size={18} />
          记一笔销售
        </button>
      </div>
      <section className="metric-grid">
        <button className="metric-card hero" onClick={() => go("month")}>
          <div className="metric-label">
            本月利润
            <ArrowUpRight size={20} />
          </div>
          <div className="big-money">
            <span>¥</span>
            <Money value={data.month.profit} />
          </div>
          <div className="hero-bottom">
            <span>这个月的每份努力，都有回响。</span>
            <span>{data.month.count} 笔成交</span>
          </div>
          <div className="hero-circle c1" />
          <div className="hero-circle c2" />
        </button>
        <button className="metric-card" onClick={() => go("day")}>
          <div className="metric-label">
            今日利润
            <span className="metric-icon">
              <Wallet size={18} />
            </span>
          </div>
          <div className="mid-money">
            <span>¥</span>
            <Money value={data.today.profit} />
          </div>
          <div className="metric-foot">
            今日已记录 <strong>{data.today.count}</strong> 笔销售
            <ArrowRight size={15} />
          </div>
        </button>
        <button className="metric-card" onClick={() => go("week")}>
          <div className="metric-label">
            本周利润
            <span className="metric-icon">
              <CalendarDays size={18} />
            </span>
          </div>
          <div className="mid-money">
            <span>¥</span>
            <Money value={data.week.profit} />
          </div>
          <div className="metric-foot">
            周一至周日 · {data.week.count} 笔销售
            <ArrowRight size={15} />
          </div>
        </button>
      </section>
      <div className="overview-strip">
        <span>
          <i className="live-dot" /> 本月账本
        </span>
        <div>
          销售额<strong>¥{money(data.month.revenue)}</strong>
        </div>
        <div>
          成本<strong>¥{money(data.month.cost)}</strong>
        </div>
        <button className="total-link" onClick={() => onFilter({})}>
          累计利润<strong>¥{money(data.all.profit)}</strong>
          <ArrowRight size={13} />
        </button>
      </div>
      <section className="panel trend-panel">
        <div className="panel-heading">
          <div>
            <h2>利润走势</h2>
            <p>
              {period === "day"
                ? "最近 7 天"
                : period === "week"
                  ? "最近 8 周"
                  : "最近 12 个月"}{" "}
              · 点击柱形查看明细
            </p>
          </div>
          <div className="segmented" aria-label="趋势周期">
            {(["day", "week", "month"] as Period[]).map((p, i) => (
              <button
                key={p}
                className={p === period ? "active" : ""}
                aria-pressed={p === period}
                onClick={() => {
                  setPeriod(p);
                  setHover(null);
                }}
              >
                {["每日", "每周", "每月"][i]}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-summary">
          <span>{hover ? `${hover.from} 至 ${hover.to}` : "所选时段利润"}</span>
          <strong>¥{money(hover?.profit ?? chartTotal.profit)}</strong>
          <span className="chart-detail">
            {hover ? hover.count : chartTotal.count} 笔 · 收入 ¥
            {money(hover?.revenue ?? chartTotal.revenue)} · 成本 ¥
            {money(hover?.cost ?? chartTotal.cost)}
          </span>
        </div>
        <div
          className={`bar-chart period-${period} ${anyNegative ? "has-negative" : ""}`}
          role="group"
          aria-label="利润柱状图"
        >
          <div className="chart-grid">
            <span>¥{money(peak)}</span>
            <span>{anyNegative ? "0" : "¥" + money(Math.round(peak / 2))}</span>
            <span>{anyNegative ? "−¥" + money(peak) : "0"}</span>
          </div>
          <div className="bar-columns">
            {chart.map((b, i) => (
              <button
                key={b.key}
                className={`bar-column ${b.profit < 0 ? "loss" : ""} ${i === chart.length - 1 ? "last" : ""}`}
                aria-label={`${b.from}至${b.to} 利润${money(b.profit)}元，查看明细`}
                onMouseEnter={() => setHover(b)}
                onFocus={() => setHover(b)}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
                onClick={() => onFilter({ from: b.from, to: b.to })}
              >
                <div className="bar-track">
                  <span
                    className="bar"
                    style={{
                      height: `${Math.max((Math.abs(b.profit) / peak) * (anyNegative ? 45 : 100), b.count ? 2 : 0)}%`,
                    }}
                  >
                    <span className="bar-tip">¥{money(b.profit)}</span>
                  </span>
                </div>
                <span className="bar-label">{b.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
      <CustomerRanking api={api} version={version} onCustomer={onCustomer} />
      <div className="dashboard-bottom">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>最近的销售</h2>
              <p>一笔笔记录，积累每一份收获</p>
            </div>
            <button className="text-button" onClick={() => onFilter({})}>
              全部明细
              <ArrowRight size={16} />
            </button>
          </div>
          {data.recent.length ? (
            <SaleRows rows={data.recent} onEdit={onEdit} />
          ) : (
            <Empty title="从第一笔销售开始">
              <button className="text-button" onClick={onNew}>
                记一笔销售 →
              </button>
            </Empty>
          )}
        </section>
        <section className="panel product-ranking">
          <div className="panel-heading">
            <div>
              <h2>本月商品贡献</h2>
              <p>哪些商品带来了利润</p>
            </div>
            <TrendingUp size={19} className="muted" />
          </div>
          {data.products.length ? (
            data.products.map((p, i) => (
              <div className="rank-row" key={p.name}>
                <span className="rank-index">0{i + 1}</span>
                <div>
                  <div className="rank-top">
                    <strong>{p.name}</strong>
                    <Money value={p.profit} />
                  </div>
                  <div className="rank-track">
                    <span
                      style={{
                        width: `${(Math.max(0, p.profit) / Math.max(...data.products.map((p) => p.profit), 1)) * 100}%`,
                      }}
                    />
                  </div>
                  <small>{p.count} 笔成交</small>
                </div>
              </div>
            ))
          ) : (
            <Empty title="本月还没有记录" />
          )}
          <div className="quiet-note">
            <ReceiptText size={15} />
            利润 = 销售额 − 成本
          </div>
        </section>
      </div>
    </>
  );
}

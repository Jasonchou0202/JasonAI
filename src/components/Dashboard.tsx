import { useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  Plus,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import type {
  Api,
  Dashboard as Data,
  Period,
  Filters,
  Sale,
  Bucket,
  SalesPage,
} from "../domain/model";
import { money, totals } from "../domain/finance";
import { today, periodRange } from "../domain/dates";
import { useQuery, ErrorNote, Loading, Money, Empty } from "./ui";
import { CustomerRanking } from "./CustomerRanking";
import { ProfitTargetChart } from "./ProfitTargetChart";
import "../profit-target.css";
import { QuadrantMatrix } from "./QuadrantMatrix";
import { MonthlyQuadrantChart, NewCustomerTrend } from "./MonthlyCharts";
import { lastMonthSamePeriod, samePeriodGrowth } from "./growth";
import heroArt800 from "../assets/hero-octopus-800.webp";
import heroArt1200 from "../assets/hero-octopus-1200.webp";
import "../dashboard.css";
export function Dashboard({
  api,
  version,
  onFilter,
  onNew,
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
  // 上月同期（1 日到同一天）的合计，只读，用来算「比上月同期」
  const { data: lastPeriod } = useQuery<SalesPage>(
    api,
    "sales.list",
    lastMonthSamePeriod(today()),
    version,
  );
  const [period, setPeriod] = useState<Period>("day");
  const [hover, setHover] = useState<Bucket | null>(null);
  // 触屏：第一次点柱形先看金额，再点一次（或点“查看这段明细”）才进入明细
  const [armed, setArmed] = useState<string | null>(null);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || loading) return <Loading />;
  const chart =
    period === "day" ? data.days : period === "week" ? data.weeks : data.months;
  const chartTotal = {
    ...totals(chart),
    count: chart.reduce((n, b) => n + b.count, 0),
  };
  const armedBucket = chart.find((b) => b.key === armed) || null;
  const shown = hover ?? armedBucket;
  const touchOnly = () =>
    typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
  const peak = Math.max(...chart.map((b) => Math.abs(b.profit)), 100);
  const anyNegative = chart.some((b) => b.profit < 0);
  const go = (p: Period) => onFilter(periodRange(today(), p));
  const [year, monthNo] = today().split("-");
  const growth = lastPeriod
    ? samePeriodGrowth(data.month.profit, lastPeriod.totals.profit)
    : null;
  return (
    <div className="dash-page">
      <section className="dash-hero" aria-labelledby="dash-title">
        <img
          className="dash-hero-art"
          src={heroArt800}
          srcSet={`${heroArt800} 800w, ${heroArt1200} 1200w`}
          sizes="(max-width: 680px) 520px, 760px"
          width={1200}
          height={1200}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          fetchPriority="low"
        />
        <div className="dash-hero-inner">
          <h1 id="dash-title" className="dash-hero-title">
            生意概览
            <span>
              {" "}
              · {year} 年 {Number(monthNo)} 月
            </span>
          </h1>
          <button
            className="dash-hero-number"
            onClick={() => go("month")}
            aria-label={`本月利润 ${money(data.month.profit)} 元，查看本月明细`}
          >
            <span className="dash-hero-label">本月利润</span>
            <span className="dash-hero-value">
              <span className="dash-hero-currency">¥</span>
              <Money value={data.month.profit} />
            </span>
          </button>
          <p className="dash-hero-meta">
            {growth !== null && (
              <span className={`dash-growth ${growth >= 0 ? "up" : "down"}`}>
                {growth >= 0 ? (
                  <TrendingUp size={14} aria-hidden="true" />
                ) : (
                  <TrendingDown size={14} aria-hidden="true" />
                )}
                比上月同期 {growth >= 0 ? "+" : "−"}
                {Math.abs(growth)}%
              </span>
            )}
            <span>本月 {data.month.count} 笔成交</span>
          </p>
          <div className="dash-hero-actions">
            <button className="dash-cta" onClick={onNew}>
              <Plus size={17} aria-hidden="true" />
              记一笔销售
            </button>
            <button className="dash-quick" onClick={() => go("day")}>
              今日 <strong>¥{money(data.today.profit)}</strong>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
            <button className="dash-quick" onClick={() => go("week")}>
              本周 <strong>¥{money(data.week.profit)}</strong>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
      <section className="dash-stats" aria-label="本月账本">
        <div>
          <span>本月销售额</span>
          <strong>¥{money(data.month.revenue)}</strong>
        </div>
        <div>
          <span>本月成本</span>
          <strong>¥{money(data.month.cost)}</strong>
        </div>
        <div>
          <span>本月成交</span>
          <strong>
            {data.month.count}
            <small> 笔</small>
          </strong>
        </div>
      </section>
      <section className="panel trend-panel">
        <div className="panel-heading">
          <div>
            <h2>利润走势</h2>
            <p>
              {period === "day"
                ? "最近 7 天"
                : period === "week"
                  ? "最近 8 周"
                  : "默认显示本月前后半年，拖动下方进度条查看其他月份（目标至 2027 年 12 月）"}{" "}
              ·{" "}
              <span className="hint-pointer">指向柱形看金额，点击查看明细</span>
              <span className="hint-touch">点柱形看金额，再点一次看明细</span>
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
                  setArmed(null);
                }}
              >
                {["每日", "每周", "每月"][i]}
              </button>
            ))}
          </div>
        </div>
        <div className="chart-summary">
          <span>{shown ? `${shown.from} 至 ${shown.to}` : "所选时段利润"}</span>
          <strong>¥{money(shown?.profit ?? chartTotal.profit)}</strong>
          <span className="chart-detail">
            {shown ? shown.count : chartTotal.count} 笔 · 收入 ¥
            {money(shown?.revenue ?? chartTotal.revenue)} · 成本 ¥
            {money(shown?.cost ?? chartTotal.cost)}
          </span>
          {armedBucket && (
            <button
              type="button"
              className="chart-open"
              onClick={() =>
                onFilter({ from: armedBucket.from, to: armedBucket.to })
              }
            >
              查看这段明细
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        {period === "month" ? (
          <ProfitTargetChart months={data.months} current={today().slice(0, 7)} startProfit={data.profitTargetStart} />
        ) : (
        <div
          className={`bar-chart dash-chart period-${period} ${anyNegative ? "has-negative" : ""}`}
          role="group"
          aria-label="利润柱状图"
        >
          <div className="bar-columns">
            {chart.map((b, i) => (
              <button
                key={b.key}
                className={`bar-column ${b.profit < 0 ? "loss" : ""} ${i === chart.length - 1 ? "last" : ""} ${armed === b.key ? "armed" : ""}`}
                aria-label={`${b.from}至${b.to} 利润${money(b.profit)}元，查看明细`}
                onMouseEnter={() => setHover(b)}
                onFocus={() => setHover(b)}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
                onClick={(e) => {
                  // 鼠标连点的第二下不算：在记一笔页双击「保存」时，第二下可能落在刚出现的走势图上（触屏本来就要点两次，不受影响）
                  if (e.detail > 1 && !touchOnly()) return;
                  if (touchOnly() && armed !== b.key) {
                    setArmed(b.key);
                    return;
                  }
                  onFilter({ from: b.from, to: b.to });
                }}
              >
                <div className="bar-track">
                  <span
                    className="bar"
                    style={{
                      height: `${Math.max((Math.abs(b.profit) / peak) * (anyNegative ? 45 : 88), b.count ? 3 : 0)}%`,
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
        )}
      </section>
      <CustomerRanking
        api={api}
        version={version}
        onCustomer={onCustomer}
        allProfit={data.all.profit}
        onAllProfit={() => onFilter({})}
      />
      <QuadrantMatrix api={api} />
      <div className="monthly-charts">
        <NewCustomerTrend />
        <MonthlyQuadrantChart />
      </div>
      <section className="panel product-ranking product-bars" aria-labelledby="product-bars-title">
        <div className="panel-heading">
          <div>
            <h2 id="product-bars-title">本月商品贡献</h2>
            <p>本月利润前 5 的商品 · 利润 = 销售额 − 成本</p>
          </div>
          <button className="text-button" onClick={() => go("month")}>
            本月明细
            <ArrowRight size={16} />
          </button>
        </div>
        {data.products.length ? (
          <ol className="product-bar-chart" aria-label="本月商品利润前 5 柱状图">
            {data.products.map((p, i) => {
              const top = Math.max(...data.products.map((x) => x.profit), 1);
              return (
                <li key={p.name} aria-label={`第 ${i + 1} 名 ${p.name}，利润 ${money(p.profit)} 元，${p.count} 笔`}>
                  <span className="product-bar-value">
                    ¥<Money value={p.profit} />
                  </span>
                  <span className="product-bar-track">
                    <span
                      className={`product-bar ${i === 0 ? "first" : ""}`}
                      style={{ height: `${Math.max((Math.max(0, p.profit) / top) * 100, p.profit > 0 ? 4 : 0)}%` }}
                    />
                  </span>
                  <span className="product-bar-name" title={p.name}>
                    <b>0{i + 1}</b>
                    {p.name}
                  </span>
                  <small>{p.count} 笔</small>
                </li>
              );
            })}
          </ol>
        ) : (
          <Empty title="本月还没有记录">
            <button className="text-button" onClick={onNew}>
              记一笔销售 →
            </button>
          </Empty>
        )}
      </section>
    </div>
  );
}

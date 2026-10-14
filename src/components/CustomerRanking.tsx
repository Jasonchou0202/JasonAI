import { useState } from "react";
import { ChevronLeft, ChevronRight, ArrowUpRight, Users } from "lucide-react";
import type { Api, RankPeriod, RankPeriodType } from "../domain/model";
import { money } from "../domain/finance";
import {
  displayCustomerName,
  rankPeriodLabel,
  shiftRankPeriod,
} from "../domain/customers";
import {
  currentMonth,
  useCustomerQuery,
  type CustomerRankingData,
} from "../lib/customer-ui";
import { Empty, ErrorNote, Loading, Money } from "./ui";
import "../customer.css";

const PERIOD_TABS: { type: RankPeriodType; label: string }[] = [
  { type: "all", label: "全部" },
  { type: "month", label: "月" },
  { type: "quarter", label: "季" },
  { type: "half", label: "半年" },
  { type: "year", label: "年" },
];
const PROFIT_LABEL: Record<RankPeriodType, string> = {
  all: "累计利润",
  month: "月利润",
  quarter: "季利润",
  half: "半年利润",
  year: "年利润",
};

export function CustomerRanking({
  api,
  version,
  onCustomer,
}: {
  api: Api;
  version: number;
  onCustomer: (id: string, month: string) => void;
}) {
  const [period, setPeriod] = useState<RankPeriod>({ type: "all" });
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading } = useCustomerQuery<CustomerRankingData>(
    api,
    "customers.ranking",
    { period },
    version,
    refresh,
  );
  function currentValue(type: RankPeriodType): string {
    if (type === "month") return currentMonth();
    const beijing = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const year = beijing.getUTCFullYear();
    const month = beijing.getUTCMonth() + 1;
    if (type === "year") return String(year);
    if (type === "quarter")
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    return `${year}-H${month <= 6 ? 1 : 2}`;
  }
  function changeType(type: RankPeriodType) {
    if (type === period.type) return;
    setExpanded(false);
    setPeriod(
      type === "all" ? { type: "all" } : { type, value: currentValue(type) },
    );
  }
  function shift(delta: number) {
    setExpanded(false);
    setPeriod(shiftRankPeriod(period, delta));
  }
  function changeMonth(value: string) {
    if (/^\d{4}-\d{2}$/.test(value)) {
      setExpanded(false);
      setPeriod({ type: "month", value });
    }
  }
  const query = search.trim().toLocaleLowerCase();
  const items = data?.items.filter((row) => {
    if (!query) return true;
    return [row.name, ...row.aliases, ...row.products.map((p) => p.name)]
      .map((text) => text.toLocaleLowerCase())
      .join(" ")
      .includes(query);
  });
  const rows = expanded || query ? items : items?.slice(0, 20);
  return (
    <section className="panel customer-ui customer-ranking">
      <div className="panel-heading customer-heading">
        <div>
          <h2>
            <Users size={17} /> 核心客户
          </h2>
          <p>全部客户按利润排行，支持全部 / 月 / 季 / 半年 / 年</p>
        </div>
      </div>
      <div className="customer-pad">
        <div className="ranking-controls">
          <div className="period-tabs" role="tablist" aria-label="排行周期">
            {PERIOD_TABS.map((tab) => (
              <button
                key={tab.type}
                role="tab"
                aria-selected={period.type === tab.type}
                className={period.type === tab.type ? "selected" : ""}
                onClick={() => changeType(tab.type)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="ranking-period">
            {period.type !== "all" && (
              <button
                className="icon-button"
                aria-label="排行上一周期"
                onClick={() => shift(-1)}
              >
                <ChevronLeft size={18} />
              </button>
            )}
            {period.type === "month" ? (
              <input
                type="month"
                aria-label="排行月份"
                value={period.value || currentMonth()}
                onChange={(e) => changeMonth(e.target.value)}
              />
            ) : (
              <strong className="ranking-period-label">
                {rankPeriodLabel(period)}
              </strong>
            )}
            {period.type !== "all" && (
              <button
                className="icon-button"
                aria-label="排行下一周期"
                onClick={() => shift(1)}
              >
                <ChevronRight size={18} />
              </button>
            )}
          </div>
          <input
            type="search"
            className="ranking-search"
            aria-label="搜索客户或商品"
            placeholder="搜索客户或商品"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {error && (
          <>
            <ErrorNote>{error}</ErrorNote>
            <button
              className="text-button"
              onClick={() => setRefresh((v) => v + 1)}
            >
              重新读取
            </button>
          </>
        )}
        {loading && <Loading />}
        {!loading && data && (
          <>
            <div className="customer-summary">
              <span>{data.totals.count} 笔成交</span>
              <span>
                {PROFIT_LABEL[period.type]}{" "}
                <strong>¥{money(data.totals.profit)}</strong>
              </span>
            </div>
            {rows?.length ? (
              <ol className="customer-ranks">
                {rows.map((row) => (
                  <li key={row.customerId}>
                    <button
                      className="customer-rank-link"
                      onClick={() =>
                        onCustomer(
                          row.customerId,
                          period.type === "month" ? period.value! : "all",
                        )
                      }
                    >
                      <span
                        className={`customer-rank-number ${row.rank <= 3 ? "top" : ""}`}
                      >
                        {String(row.rank).padStart(2, "0")}
                      </span>
                      <span className="customer-rank-name">
                        <span className="customer-name-with-badge">
                          <strong>{displayCustomerName(row.name)}</strong>
                          {(row.pendingTaskCount ?? 0) > 0 && (
                            <span
                              className="customer-pending-badge"
                              role="status"
                              aria-label={`${row.pendingTaskCount} 条未完成日程`}
                              title={`${row.pendingTaskCount} 条未完成日程（含逾期和未来）`}
                            >
                              {row.pendingTaskCount > 99
                                ? "99+"
                                : row.pendingTaskCount}
                            </span>
                          )}
                        </span>
                        <small>
                          {row.aliases
                            .filter((a) => a !== row.name)
                            .map(displayCustomerName)
                            .filter((a) => a !== displayCustomerName(row.name))
                            .slice(0, 2)
                            .join(" / ") || `${row.totals.count} 笔成交`}
                        </small>
                      </span>
                      <span className="customer-rank-profit">
                        <Money value={row.totals.profit} />
                        <small>{row.totals.count} 笔 · 利润</small>
                        <span className="customer-rank-action">
                          管理日程 <ArrowUpRight size={13} />
                        </span>
                      </span>
                    </button>
                    <div className="customer-products">
                      {row.products.map((product) => (
                        <span key={product.name}>
                          <strong>{product.name}</strong>
                          <small>
                            {product.count} 笔 · ¥{money(product.profit)}
                          </small>
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty
                title={query ? "没有匹配的客户" : "这个周期还没有客户成交"}
              >
                {query
                  ? "换个关键词，或清空搜索。"
                  : "记录客户名称后，就能看到利润排行。"}
              </Empty>
            )}
            {!query && data.items.length > 20 && (
              <button
                className="text-button customer-expand"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded
                  ? "收起至前 20 位"
                  : `展开全部 ${data.items.length} 位客户`}
              </button>
            )}
            <div className="customer-summary customer-unassigned">
              <span>未填写客户 · {data.unassigned.count} 笔</span>
              <span>利润 ¥{money(data.unassigned.profit)}</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

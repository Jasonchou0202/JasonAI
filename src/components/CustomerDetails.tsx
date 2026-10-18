import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
} from "lucide-react";
import type { Api, Sale } from "../domain/model";
import { money, totals } from "../domain/finance";
import { customerProducts, displayCustomerName } from "../domain/customers";
import {
  currentMonth,
  defaultSalesView,
  inSalesView,
  salesViewFallbackHint,
  shiftMonth,
  useCustomerQuery,
  type SalesView,
  type CustomerDetail,
  type CustomerMode,
} from "../lib/customer-ui";
import { Calendar } from "./Calendar";
import { Empty, ErrorNote, Loading, Money } from "./ui";
import "../customer.css";

export interface CustomerDetailsProps {
  api: Api;
  version: number;
  mode: CustomerMode;
  id: string;
  month?: string;
  onChange: (msg: string) => void;
  onBack: () => void;
  onCustomer: (id: string, month?: string) => void;
  onEditSale?: (sale: Sale) => void;
}
export function CustomerDetails(props: CustomerDetailsProps) {
  return <CustomerProfile key={`${props.mode}:${props.id}`} {...props} />;
}
const PAGE_SIZE = 20;
function monthLabel(month: string) {
  return `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`;
}
function CustomerProfile({
  api,
  version,
  mode,
  id,
  month: initialMonth,
  onChange,
  onBack,
  onCustomer,
  onEditSale,
}: CustomerDetailsProps) {
  const explicitMonth =
    initialMonth && initialMonth !== "all" ? initialMonth : undefined;
  const [month, setMonth] = useState(explicitMonth || currentMonth);
  // 链接带 month=all：直接看全部历史；带具体月份：看那个月；
  // 都没带（null）：读到数据后默认看本月，本月没有成交就自动看近 3 个月，再没有就看全部
  const [view, setView] = useState<SalesView | null>(
    initialMonth === "all" ? "all" : explicitMonth ? "month" : null,
  );
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [hint, setHint] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (initialMonth === "all") setView("all");
    else if (initialMonth) {
      setMonth(initialMonth);
      setView("month");
    }
  }, [initialMonth]);
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [view, month]);
  // 只读一次全部历史，按月 / 近 3 个月 / 全部在本机筛选，切换时不用重新读取
  const { data, error, loading } = useCustomerQuery<CustomerDetail>(
    api,
    "customers.detail",
    { id, month: "all" },
    version,
    refresh,
  );
  const thisMonth = currentMonth();
  const recentStart = shiftMonth(thisMonth, -2);
  const allSales = data?.sales || [];
  const inView = (v: SalesView, s: Sale) =>
    inSalesView(v, s.date, month, thisMonth);
  const activeView: SalesView = view ?? defaultSalesView(allSales, thisMonth);
  // 默认范围算出来后就固定下来：之后改了记录、刷新数据，也不会自己跳回本月
  useEffect(() => {
    if (view !== null || !data) return;
    const picked = defaultSalesView(data.sales, thisMonth);
    setView(picked);
    setHint(salesViewFallbackHint(picked));
  }, [data, view, thisMonth]);
  function pickView(v: SalesView) {
    setHint("");
    setView(v);
  }
  const sales = allSales.filter((s) => inView(activeView, s));
  const viewTotals = totals(sales);
  const viewProducts = customerProducts(sales);
  const groups: { month: string; sales: Sale[] }[] = [];
  for (const sale of sales) {
    const key = sale.date.slice(0, 7);
    if (groups.at(-1)?.month !== key) groups.push({ month: key, sales: [] });
    groups.at(-1)!.sales.push(sale);
  }
  let budget = visible;
  const shownGroups = groups
    .map((g) => {
      const shown = g.sales.slice(0, Math.max(0, budget));
      budget -= shown.length;
      return { ...g, shown };
    })
    .filter((g) => g.shown.length);
  const remaining = sales.length - Math.min(visible, sales.length);
  const periodText =
    activeView === "month"
      ? monthLabel(month)
      : activeView === "recent"
        ? `近 3 个月（${monthLabel(recentStart)}至${monthLabel(thisMonth)}）`
        : "全部历史";
  const calendarMonth = activeView === "month" ? month : undefined;
  function changeMonth(value: string) {
    if (/^\d{4}-\d{2}$/.test(value)) {
      setMonth(value);
      pickView("month");
    }
  }
  return (
    <div className="customer-ui customer-details">
      <div className="page-heading customer-heading">
        <div>
          <button className="text-button" onClick={onBack}>
            <ArrowLeft size={15} />
            返回
          </button>
          <h1>{data ? displayCustomerName(data.customer.name) : "客户详情"}</h1>
          <p className="subtle">成交记录与每一次跟进，放在一起看。</p>
        </div>
      </div>
      {error && (
        <>
          <ErrorNote>{error}</ErrorNote>
          <button
            className="text-button"
            onClick={() => setRefresh((v) => v + 1)}
          >
            重新读取客户
          </button>
        </>
      )}
      {loading && <Loading />}
      {data && !loading && (
        <>
          {data.customer.mergedInto && (
            <div className="customer-merged">
              <span>该名称已合并到另一位客户。</span>
              <button
                className="text-button"
                onClick={() =>
                  onCustomer(data.customer.mergedInto!, calendarMonth || "all")
                }
              >
                查看归属客户
                <ArrowUpRight size={15} />
              </button>
            </div>
          )}
          {data.aliases.length > 0 && (
            <div className="customer-alias-chips" aria-label="客户别名">
              {data.aliases.map((name) => (
                <span key={name}>{displayCustomerName(name)}</span>
              ))}
            </div>
          )}
          <section className="panel">
            <div className="panel-heading customer-heading customer-period-heading">
              <div>
                <h2>成交记录</h2>
                <p>
                  <span className="customer-period-text">{periodText}</span>
                  {" · "}利润 = 收入 − 成本
                </p>
              </div>
              <div className="customer-period-controls">
                <div
                  className="segmented customer-period"
                  role="group"
                  aria-label="成交时间范围"
                >
                  <button
                    type="button"
                    aria-pressed={activeView === "month" && month === thisMonth}
                    className={
                      activeView === "month" && month === thisMonth
                        ? "active"
                        : ""
                    }
                    onClick={() => {
                      setMonth(thisMonth);
                      pickView("month");
                    }}
                  >
                    本月
                  </button>
                  <button
                    type="button"
                    aria-pressed={activeView === "recent"}
                    className={activeView === "recent" ? "active" : ""}
                    onClick={() => pickView("recent")}
                  >
                    近 3 个月
                  </button>
                  <button
                    type="button"
                    aria-pressed={activeView === "all"}
                    className={activeView === "all" ? "active" : ""}
                    onClick={() => pickView("all")}
                  >
                    全部
                  </button>
                </div>
                {activeView === "month" && (
                  <div className="customer-month">
                    <button
                      className="icon-button"
                      aria-label="客户销售上个月"
                      onClick={() => changeMonth(shiftMonth(month, -1))}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <input
                      type="month"
                      aria-label="客户销售月份"
                      value={month}
                      onChange={(e) => changeMonth(e.target.value)}
                    />
                    <button
                      className="icon-button"
                      aria-label="客户销售下个月"
                      onClick={() => changeMonth(shiftMonth(month, 1))}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                )}
              </div>
            </div>
            {hint && (
              <p className="customer-view-hint" role="status">
                {hint}
              </p>
            )}
            <div className="customer-stats">
              <div>
                <small>收入</small>
                <strong>¥{money(viewTotals.revenue)}</strong>
              </div>
              <div>
                <small>成本</small>
                <strong>¥{money(viewTotals.cost)}</strong>
              </div>
              <div>
                <small>利润</small>
                <strong
                  className={viewTotals.profit < 0 ? "negative" : "positive"}
                >
                  ¥{money(viewTotals.profit)}
                </strong>
              </div>
              <div>
                <small>销售笔数</small>
                <strong>{viewTotals.count}</strong>
              </div>
            </div>
            <div className="customer-products customer-detail-products">
              {viewProducts.map((p) => (
                <span key={p.name}>
                  <strong>{p.name}</strong>
                  <small>
                    {p.count} 笔 · 利润 ¥{money(p.profit)}
                  </small>
                </span>
              ))}
            </div>
            {sales.length ? (
              <div className="customer-sales">
                {shownGroups.map((g) => {
                  const sub = totals(g.sales);
                  return (
                    <section
                      className="customer-month-group"
                      key={g.month}
                      aria-label={`${monthLabel(g.month)}成交`}
                    >
                      <h3 className="customer-month-title">
                        <span>{monthLabel(g.month)}</span>
                        <small>
                          {sub.count} 笔 · 收入 ¥{money(sub.revenue)} · 利润{" "}
                          <b className={sub.profit < 0 ? "negative" : ""}>
                            ¥{money(sub.profit)}
                          </b>
                        </small>
                      </h3>
                      {g.shown.map((sale) => {
                        const content = (
                          <>
                            <span className="customer-sale-info">
                              <strong>{sale.productName}</strong>
                              <small>
                                {sale.date} ·{" "}
                                {sale.customer
                                  ? displayCustomerName(sale.customer)
                                  : displayCustomerName(data.customer.name)}
                              </small>
                              {sale.note && (
                                <small className="customer-sale-note">
                                  {sale.note}
                                </small>
                              )}
                            </span>
                            <span className="customer-sale-profit">
                              <Money value={sale.revenue - sale.cost} />
                              <small>
                                收入 ¥{money(sale.revenue)} · 成本 ¥
                                {money(sale.cost)}
                              </small>
                            </span>
                            {onEditSale && <ArrowUpRight size={16} />}
                          </>
                        );
                        return onEditSale ? (
                          <button
                            className="customer-sale"
                            key={sale.id}
                            onClick={() => onEditSale(sale)}
                          >
                            {content}
                          </button>
                        ) : (
                          <div className="customer-sale" key={sale.id}>
                            {content}
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
                {sales.length > PAGE_SIZE && (
                  <div className="customer-paging">
                    <span className="customer-paging-count" role="status">
                      已显示 {sales.length - remaining} / {sales.length}
                    </span>
                    {remaining > 0 && (
                      <button
                        type="button"
                        className="button secondary customer-more"
                        onClick={() => setVisible((v) => v + PAGE_SIZE)}
                      >
                        查看更多（还有 {remaining} 笔）
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Empty
                title={
                  activeView === "all"
                    ? "还没有销售记录"
                    : activeView === "recent"
                      ? "近 3 个月还没有销售记录"
                      : "这个月还没有销售记录"
                }
              />
            )}
          </section>
        </>
      )}
      <Calendar
        api={api}
        version={version}
        mode={mode}
        customerId={data?.customer.mergedInto || id}
        month={calendarMonth}
        onChange={(msg) => {
          setRefresh((v) => v + 1);
          onChange(msg);
        }}
        onCustomer={onCustomer}
      />
    </div>
  );
}

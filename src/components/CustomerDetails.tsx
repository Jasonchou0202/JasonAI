import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
} from "lucide-react";
import type { Api, Sale } from "../domain/model";
import { money } from "../domain/finance";
import {
  currentMonth,
  shiftMonth,
  useCustomerQuery,
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
  const [month, setMonth] = useState(initialMonth || currentMonth);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (initialMonth) setMonth(initialMonth);
  }, [initialMonth]);
  const { data, error, loading } = useCustomerQuery<CustomerDetail>(
    api,
    "customers.detail",
    { id, month },
    version,
    refresh,
  );
  function changeMonth(value: string) {
    if (/^\d{4}-\d{2}$/.test(value)) setMonth(value);
  }
  return (
    <div className="customer-ui customer-details">
      <div className="page-heading customer-heading">
        <div>
          <button className="text-button" onClick={onBack}>
            <ArrowLeft size={15} />
            返回
          </button>
          <h1>{data?.customer.name || "客户详情"}</h1>
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
                onClick={() => onCustomer(data.customer.mergedInto!, month)}
              >
                查看归属客户
                <ArrowUpRight size={15} />
              </button>
            </div>
          )}
          {data.aliases.length > 0 && (
            <div className="customer-alias-chips" aria-label="客户别名">
              {data.aliases.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
          )}
          <section className="panel">
            <div className="panel-heading customer-heading">
              <div>
                <h2>每月成交</h2>
                <p>利润 = 收入 − 成本</p>
              </div>
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
            </div>
            <div className="customer-stats">
              <div>
                <small>收入</small>
                <strong>¥{money(data.totals.revenue)}</strong>
              </div>
              <div>
                <small>成本</small>
                <strong>¥{money(data.totals.cost)}</strong>
              </div>
              <div>
                <small>利润</small>
                <strong
                  className={data.totals.profit < 0 ? "negative" : "positive"}
                >
                  ¥{money(data.totals.profit)}
                </strong>
              </div>
              <div>
                <small>销售笔数</small>
                <strong>{data.totals.count}</strong>
              </div>
            </div>
            <div className="customer-products customer-detail-products">
              {data.products.map((p) => (
                <span key={p.name}>
                  <strong>{p.name}</strong>
                  <small>
                    {p.count} 笔 · 利润 ¥{money(p.profit)}
                  </small>
                </span>
              ))}
            </div>
            {data.sales.length ? (
              <div className="customer-sales">
                {data.sales.map((sale) => {
                  const content = (
                    <>
                      <span className="customer-sale-info">
                        <strong>{sale.productName}</strong>
                        <small>
                          {sale.date} · {sale.customer || data.customer.name}
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
                          收入 ¥{money(sale.revenue)} · 成本 ¥{money(sale.cost)}
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
              </div>
            ) : (
              <Empty title="这个月还没有销售记录" />
            )}
          </section>
        </>
      )}
      <Calendar
        api={api}
        version={version}
        mode={mode}
        customerId={data?.customer.mergedInto || id}
        month={month}
        onChange={(msg) => {
          setRefresh((v) => v + 1);
          onChange(msg);
        }}
        onCustomer={onCustomer}
      />
    </div>
  );
}

import { useState } from "react";
import { ChevronLeft, ChevronRight, ArrowUpRight, Users } from "lucide-react";
import type { Api } from "../domain/model";
import { money } from "../domain/finance";
import {
  currentMonth,
  shiftMonth,
  useCustomerQuery,
  type CustomerRankingData,
} from "../lib/customer-ui";
import { Empty, ErrorNote, Loading, Money } from "./ui";
import "../customer.css";

export function CustomerRanking({
  api,
  version,
  onCustomer,
}: {
  api: Api;
  version: number;
  onCustomer: (id: string, month: string) => void;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [expanded, setExpanded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { data, error, loading } = useCustomerQuery<CustomerRankingData>(
    api,
    "customers.ranking",
    { month },
    version,
    refresh,
  );
  function changeMonth(value: string) {
    if (/^\d{4}-\d{2}$/.test(value)) {
      setMonth(value);
      setExpanded(false);
    }
  }
  const rows = expanded ? data?.items : data?.items.slice(0, 10);
  return (
    <section className="panel customer-ui customer-ranking">
      <div className="panel-heading customer-heading">
        <div>
          <h2>
            <Users size={17} /> 客户贡献排行
          </h2>
          <p>按月看看客户带来的利润与成交商品</p>
        </div>
        <div className="customer-month">
          <button
            className="icon-button"
            aria-label="排行上个月"
            onClick={() => changeMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <input
            type="month"
            aria-label="排行月份"
            value={month}
            onChange={(e) => changeMonth(e.target.value)}
          />
          <button
            className="icon-button"
            aria-label="排行下个月"
            onClick={() => changeMonth(shiftMonth(month, 1))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      {error && (
        <div className="customer-pad">
          <ErrorNote>{error}</ErrorNote>
          <button
            className="text-button"
            onClick={() => setRefresh((v) => v + 1)}
          >
            重新读取
          </button>
        </div>
      )}
      {loading && <Loading />}
      {!loading && data && (
        <>
          <div className="customer-summary">
            <span>{data.totals.count} 笔成交</span>
            <span>
              月利润 <strong>¥{money(data.totals.profit)}</strong>
            </span>
          </div>
          {rows?.length ? (
            <ol className="customer-ranks">
              {rows.map((row) => (
                <li key={row.customerId}>
                  <button
                    className="customer-rank-link"
                    onClick={() => onCustomer(row.customerId, month)}
                  >
                    <span
                      className={`customer-rank-number ${row.rank <= 3 ? "top" : ""}`}
                    >
                      {String(row.rank).padStart(2, "0")}
                    </span>
                    <span className="customer-rank-name">
                      <strong>{row.name}</strong>
                      <small>
                        {row.aliases
                          .filter((a) => a !== row.name)
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
            <Empty title="这个月还没有客户成交">
              记录客户名称后，就能看到每月贡献。
            </Empty>
          )}
          {data.items.length > 10 && (
            <button
              className="text-button customer-expand"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? "收起至前 10 位"
                : `展开全部 ${data.items.length} 位客户`}
            </button>
          )}
          <div className="customer-summary customer-unassigned">
            <span>未填写客户 · {data.unassigned.count} 笔</span>
            <span>利润 ¥{money(data.unassigned.profit)}</span>
          </div>
        </>
      )}
    </section>
  );
}

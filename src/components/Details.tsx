import { useRef, useState } from "react";
import {
  Download,
  Plus,
  Search,
  Trash2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Pencil,
} from "lucide-react";
import type { Api, Filters, Product, Sale, SalesPage } from "../domain/model";
import { money } from "../domain/finance";
import { today, periodRange } from "../domain/dates";
import {
  useQuery,
  ErrorNote,
  Loading,
  Empty,
  Money,
  Modal,
  message,
} from "./ui";
import { downloadCsv } from "../lib/files";
export function Details({
  api,
  version,
  filters,
  setFilters,
  onEdit,
  onNew,
  onChange,
}: {
  api: Api;
  version: number;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onEdit: (s: Sale) => void;
  onNew: () => void;
  onChange: (s: string) => void;
}) {
  const { data, error, loading } = useQuery<SalesPage>(
    api,
    "sales.list",
    filters,
    version,
  );
  const { data: products } = useQuery<Product[]>(
    api,
    "products.list",
    {},
    version,
  );
  const [confirm, setConfirm] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  const [opError, setError] = useState("");
  const mutations = useRef<Record<string, string>>({});
  const filter = (f: Partial<Filters>) =>
    setFilters({ ...filters, ...f, page: 1 });
  async function mutate(row: Sale, restore = false) {
    setBusy(true);
    setError("");
    try {
      await api.call(restore ? "sales.restore" : "sales.delete", {
        id: row.id,
        revision: row.revision,
        requestId:
          mutations.current[row.id + restore + row.revision] ||
          (mutations.current[row.id + restore + row.revision] =
            crypto.randomUUID()),
      });
      setConfirm(null);
      onChange(restore ? "记录已恢复" : "记录已移入回收站");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportRows() {
    setBusy(true);
    try {
      const rows = await api.call<Sale[]>("export", filters);
      downloadCsv(rows);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">每一笔，都有迹可查</p>
          <h1>{filters.deleted ? "回收站" : "销售明细"}</h1>
          <p className="subtle">找到记录，核对收入，把生意理清楚。</p>
        </div>
        <button className="button primary" onClick={onNew}>
          <Plus size={17} />
          记一笔
        </button>
      </div>
      <section className="panel detail-panel">
        <div className="filter-top">
          <div className="search-input">
            <Search size={18} />
            <input
              aria-label="搜索销售记录"
              placeholder="搜索客户、商品或备注"
              value={filters.search || ""}
              onChange={(e) => filter({ search: e.target.value })}
            />
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void exportRows()}
          >
            <Download size={16} />
            导出明细
          </button>
        </div>
        <div className="filters">
          <label>
            从
            <input
              aria-label="起始日期"
              type="date"
              value={filters.from || ""}
              onChange={(e) => filter({ from: e.target.value })}
            />
          </label>
          <label>
            至
            <input
              aria-label="结束日期"
              type="date"
              value={filters.to || ""}
              onChange={(e) => filter({ to: e.target.value })}
            />
          </label>
          <select
            aria-label="筛选商品"
            value={filters.productId || ""}
            onChange={(e) => filter({ productId: e.target.value })}
          >
            <option value="">全部商品</option>
            {products?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="quick-filters">
            <button onClick={() => filter(periodRange(today(), "day"))}>
              今天
            </button>
            <button onClick={() => filter(periodRange(today(), "week"))}>
              本周
            </button>
            <button onClick={() => filter(periodRange(today(), "month"))}>
              本月
            </button>
            <button onClick={() => setFilters({ deleted: filters.deleted })}>
              全部
            </button>
          </div>
          <button
            className={`recycle-toggle ${filters.deleted ? "selected" : ""}`}
            onClick={() => filter({ deleted: !filters.deleted })}
          >
            <Trash2 size={14} />
            {filters.deleted ? "回到明细" : "回收站"}
          </button>
        </div>
        {(error || opError) && <ErrorNote>{error || opError}</ErrorNote>}
        {data && (
          <div className="list-summary">
            <span>
              共 <strong>{data.total}</strong> 笔
            </span>
            <span>销售额 ¥{money(data.totals.revenue)}</span>
            <span>成本 ¥{money(data.totals.cost)}</span>
            <span>
              利润{" "}
              <strong
                className={data.totals.profit < 0 ? "negative" : "positive"}
              >
                ¥{money(data.totals.profit)}
              </strong>
            </span>
          </div>
        )}
        {loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty title={filters.deleted ? "回收站是空的" : "没有找到销售记录"}>
            试试调整筛选条件，或记下第一笔销售。
          </Empty>
        ) : (
          <div className="detail-list">
            {data.items.map((r, i) => (
              <div key={r.id}>
                {(i === 0 || data.items[i - 1].date !== r.date) && (
                  <div className="date-group">
                    {r.date.replaceAll("-", " / ")}
                  </div>
                )}
                <div className="detail-row">
                  <div className="detail-main">
                    <strong>{r.productName}</strong>
                    <span>{r.customer || "未填写客户"}</span>
                    {r.note && <small>{r.note}</small>}
                  </div>
                  <div className="detail-numbers">
                    <span>
                      收入<strong>¥{money(r.revenue)}</strong>
                    </span>
                    <span>
                      成本<strong>¥{money(r.cost)}</strong>
                    </span>
                    <span>
                      利润
                      <strong
                        className={
                          r.revenue - r.cost < 0 ? "negative" : "positive"
                        }
                      >
                        ¥{money(r.revenue - r.cost)}
                      </strong>
                    </span>
                  </div>
                  <div className="detail-actions">
                    {filters.deleted ? (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void mutate(r, true)}
                      >
                        <RotateCcw size={15} />
                        恢复
                      </button>
                    ) : (
                      <>
                        <button
                          className="icon-button"
                          aria-label={`编辑${r.productName} ${r.customer}`}
                          onClick={() => onEdit(r)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`删除${r.productName} ${r.customer}`}
                          onClick={() => setConfirm(r)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {data && data.total > 30 && (
          <div className="pagination">
            <button
              className="button secondary"
              disabled={(filters.page || 1) <= 1}
              onClick={() =>
                setFilters({ ...filters, page: (filters.page || 1) - 1 })
              }
            >
              <ChevronLeft size={16} />
              上一页
            </button>
            <span>
              {filters.page || 1} / {Math.ceil(data.total / 30)}
            </span>
            <button
              className="button secondary"
              disabled={(filters.page || 1) * 30 >= data.total}
              onClick={() =>
                setFilters({ ...filters, page: (filters.page || 1) + 1 })
              }
            >
              下一页
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </section>
      {confirm && (
        <Modal
          title="移入回收站？"
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p>
            {confirm.date} · {confirm.productName} ·{" "}
            {confirm.customer || "未填写客户"}
          </p>
          <p className="subtle">
            这笔记录将从利润统计中移除，之后可以在回收站恢复。
          </p>
          {opError && <ErrorNote>{opError}</ErrorNote>}
          <div className="form-actions">
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void mutate(confirm)}
            >
              {busy ? "正在处理…" : "移入回收站"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              取消
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

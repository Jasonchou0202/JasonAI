import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTeam } from "../lib/team-ui";
import { MemberTag, useDirectory, ZhDateHint } from "../lib/members-ui";
import {
  Download,
  Plus,
  Search,
  Trash2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Pencil,
  CalendarDays,
  MoreHorizontal,
} from "lucide-react";
import type {
  Api,
  Filters,
  Product,
  Sale,
  SalesPage,
  Customer,
} from "../domain/model";
import {
  customerChoices,
  matchesCustomer,
  groupProducts,
} from "../domain/catalog";
import { money } from "../domain/finance";
import { displayCustomerName } from "../domain/customers";
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
import { QuadrantDot, QuadrantBlocks, TierBadge, useInsights } from "../lib/insights-ui";
const NO_AUDIT = { call: async <T,>() => ({ rows: [] }) as unknown as T };
export function Details({
  api,
  version,
  filters,
  setFilters,
  onEdit,
  onNew,
  onChange,
  onCustomer,
}: {
  api: Api;
  version: number;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onEdit: (s: Sale) => void;
  onNew: () => void;
  onChange: (s: string) => void;
  onCustomer: (id: string, month?: string) => void;
}) {
  const team = useTeam();
  const dir = useDirectory();
  // 回收站自己的页头、按钮间距和「查看客户」：只在日程归属开关开时（关时与线上一样）
  const trashOwn = dir.on && !!filters.deleted;
  // ⑩ 销售回收站「谁删的」：先看 sales.deletedBy（单独解冻后才有），没有就从操作日志里读（只读），都没有写「不详」
  const auditDeletes = useQuery<{ rows: { targetId?: string; actorUid: string; result: string }[] }>(
    dir.on && filters.deleted && team.isAdmin && team.me.auditEnabled ? api : NO_AUDIT,
    "audit.list",
    { action: "sales.delete", result: "ok", limit: 100 },
    version,
  );
  const deleter = (r: Sale) =>
    r.deletedBy || auditDeletes.data?.rows.find((l) => l.targetId === r.id)?.actorUid || "";
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
  const { insights } = useInsights();
  const [confirm, setConfirm] = useState<Sale | null>(null);
  const { data: customerRecords } = useQuery<Customer[]>(
    api,
    "customers.list",
    {},
    version,
  );
  const choices = customerChoices(customerRecords || []);
  const matchingCustomers = filters.search?.trim()
    ? choices.filter((c) => matchesCustomer(c, filters.search!))
    : [];
  const customerFor = (name: string) =>
    choices.find((c) => c.aliases.includes(name));
  const [purgeId, setPurgeId] = useState<string | null>(null);
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
  async function purge(row: Sale) {
    setBusy(true);
    setError("");
    try {
      await api.call("sales.purge", {
        id: row.id,
        revision: row.revision,
        requestId:
          mutations.current["purge" + row.id + row.revision] ||
          (mutations.current["purge" + row.id + row.revision] =
            crypto.randomUUID()),
      });
      setPurgeId(null);
      onChange("记录已彻底删除");
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
          <p className="eyebrow">{trashOwn ? "删掉的记录先放在这里" : "每一笔，都有迹可查"}</p>
          <h1>{filters.deleted ? "回收站" : "销售明细"}</h1>
          <p className="subtle">
            {trashOwn
              ? "误删的销售记录可以恢复；彻底删除后就找不回来了。"
              : "找到记录，核对收入，把生意理清楚。"}
          </p>
        </div>
        {!trashOwn && (
          <button className="button primary heading-new" onClick={onNew}>
            <Plus size={17} />
            记一笔
          </button>
        )}
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
          {team.isAdmin && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void exportRows()}
            >
              <Download size={16} />
              导出明细
            </button>
          )}
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
            <ZhDateHint value={filters.from} />
          </label>
          <label>
            至
            <input
              aria-label="结束日期"
              type="date"
              value={filters.to || ""}
              onChange={(e) => filter({ to: e.target.value })}
            />
            <ZhDateHint value={filters.to} />
          </label>
          <select
            aria-label="筛选商品"
            value={filters.productId || ""}
            onChange={(e) => filter({ productId: e.target.value })}
          >
            <option value="">全部商品</option>
            {groupProducts(products || []).map((g) => (
              <optgroup key={g.category} label={g.category}>
                {g.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
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
          {team.isAdmin && (
            <button
              className={`recycle-toggle ${filters.deleted ? "selected" : ""}`}
              onClick={() => filter({ deleted: !filters.deleted })}
            >
              <Trash2 size={14} />
              {filters.deleted ? "回到明细" : "回收站"}
            </button>
          )}
        </div>
        {matchingCustomers.length > 0 && (
          <div className="directory-results" aria-label="查询客户的日程管理">
            {matchingCustomers.map((c) => (
              <button
                key={c.id}
                className="button secondary"
                onClick={() => onCustomer(c.id, "all")}
              >
                <CalendarDays size={15} />
                {c.name} · 日程管理
              </button>
            ))}
          </div>
        )}
        {(error || opError) && <ErrorNote>{error || opError}</ErrorNote>}
        {data && (
          <div className="list-summary figures" aria-label="筛选结果合计">
            <div>
              <span>笔数</span>
              <strong>
                {data.total}
                <small> 笔</small>
              </strong>
            </div>
            <div>
              <span>销售额</span>
              <strong>¥{money(data.totals.revenue)}</strong>
            </div>
            <div>
              <span>成本</span>
              <strong>¥{money(data.totals.cost)}</strong>
            </div>
            <div>
              <span>利润</span>
              <strong
                className={data.totals.profit < 0 ? "negative" : "positive"}
              >
                ¥{money(data.totals.profit)}
              </strong>
            </div>
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
                <div
                  className={`detail-row ${filters.deleted ? "" : "clickable"}`}
                >
                  {filters.deleted ? (
                    <div className="detail-main">
                      <strong>{r.productName}</strong>
                      <span>
                        {r.customer
                          ? displayCustomerName(r.customer)
                          : "未填写客户"}
                      </span>
                      {r.note && <small>{r.note}</small>}
                      {dir.on && (
                        <small className="m-meta">
                          谁删的
                          {deleter(r) ? <MemberTag uid={deleter(r)} size={16} /> : <span>不详</span>}
                        </small>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="detail-main detail-open"
                      title={team.canChange(r) ? "点按编辑这笔销售" : "别人录入的记录，只能查看"}
                      onClick={() => team.canChange(r) && onEdit(r)}
                    >
                      <strong>
                        <QuadrantDot q={insights?.quadrantOf.get(r.id)} />
                        {r.productName}
                      </strong>
                      <span>
                        {r.customer
                          ? displayCustomerName(r.customer)
                          : "未填写客户"}
                      </span>
                      {r.note && <small>{r.note}</small>}
                      {/* ⑧b 录入人：只读现有的 sales.createdBy，没有 = Jason */}
                      {dir.on && (
                        <small className="m-meta">
                          录入人 <MemberTag uid={r.createdBy || dir.ownerUid} size={16} />
                        </small>
                      )}
                    </button>
                  )}
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
                  <div className={trashOwn ? "detail-actions trash-actions" : "detail-actions"}>
                    {filters.deleted ? (
                      <>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void mutate(r, true)}
                        >
                          <RotateCcw size={15} />
                          恢复
                        </button>
                        {purgeId === r.id ? (
                          <button
                            className="text-button negative"
                            disabled={busy}
                            onClick={() => void purge(r)}
                          >
                            确认彻底删除（不可恢复）
                          </button>
                        ) : (
                          <button
                            className="text-button negative"
                            disabled={busy}
                            onClick={() => setPurgeId(r.id)}
                          >
                            彻底删除
                          </button>
                        )}
                      </>
                    ) : (
                      <RowMenu
                        label={`更多操作：${r.productName} ${displayCustomerName(r.customer)}`}
                        items={[
                          ...(customerFor(r.customer)
                            ? [
                                {
                                  label: "日程管理",
                                  aria: `${displayCustomerName(r.customer)}日程管理`,
                                  icon: <CalendarDays size={15} />,
                                  onSelect: () =>
                                    onCustomer(
                                      customerFor(r.customer)!.id,
                                      "all",
                                    ),
                                },
                              ]
                            : []),
                          ...(team.canChange(r)
                            ? [
                                {
                                  label: "编辑",
                                  aria: `编辑${r.productName} ${displayCustomerName(r.customer)}`,
                                  icon: <Pencil size={15} />,
                                  onSelect: () => onEdit(r),
                                },
                                {
                                  label: "删除",
                                  aria: `删除${r.productName} ${displayCustomerName(r.customer)}`,
                                  icon: <Trash2 size={15} />,
                                  danger: true,
                                  onSelect: () => setConfirm(r),
                                },
                              ]
                            : []),
                        ]}
                      />
                    )}
                    {filters.deleted && customerFor(r.customer) && (
                      <button
                        className="text-button"
                        aria-label={
                          trashOwn
                            ? `查看客户${displayCustomerName(r.customer)}的成交和日程`
                            : `${displayCustomerName(r.customer)}日程管理`
                        }
                        {...(trashOwn ? { title: "打开这位客户的详情页（成交记录和日程）" } : {})}
                        onClick={() =>
                          onCustomer(customerFor(r.customer)!.id, "all")
                        }
                      >
                        <CalendarDays size={15} />
                        {trashOwn ? "查看客户" : "日程管理"}
                      </button>
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
            {displayCustomerName(confirm.customer) || "未填写客户"}
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

type MenuItem = {
  label: string;
  aria?: string;
  icon: ReactNode;
  danger?: boolean;
  onSelect: () => void;
};
// 行尾“⋯”菜单：收起日程管理、编辑、删除，减少每行的按钮数量
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  function move(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const list = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ),
    ];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? list.length - 1
          : (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  }
  return (
    <div
      className="row-menu"
      ref={box}
      onBlur={(e) => {
        // Tab 离开菜单（焦点移到菜单外）时收起
        // （relatedTarget 为空时是 Safari 点按钮不聚焦，交给 pointerdown 处理）
        const next = e.relatedTarget as Node | null;
        if (open && next && !box.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div
          className="row-menu-list"
          role="menu"
          aria-label={label}
          onKeyDown={move}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : ""}
              aria-label={item.aria}
              onClick={() => {
                setOpen(false);
                // 先把焦点还给 ⋯；若接着打开确认框或进入编辑页，由它们接管焦点
                trigger.current?.focus();
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

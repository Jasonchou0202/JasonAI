import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Plus, Save, RotateCcw } from "lucide-react";
import type { Api, Product, Sale, SaleInput } from "../domain/model";
import { today } from "../domain/dates";
import { displayCustomerName } from "../domain/customers";
import { money, moneyInput, parseMoney } from "../domain/finance";
import { useQuery, ErrorNote, message } from "./ui";
import { groupProducts } from "../domain/catalog";
type Draft = {
  productId: string;
  productName: string;
  customer: string;
  date: string;
  revenue: string;
  cost: string;
  note: string;
  requestId: string;
};
const fresh = (date = today()): Draft => ({
  productId: "",
  productName: "",
  customer: "",
  date,
  revenue: "",
  cost: "",
  note: "",
  requestId: crypto.randomUUID(),
});
const fromSale = (s: Sale): Draft => ({
  ...s,
  revenue: moneyInput(s.revenue),
  cost: moneyInput(s.cost),
  requestId: crypto.randomUUID(),
});
export function SaleForm({
  api,
  mode,
  edit,
  onSaved,
  onBack,
}: {
  api: Api;
  mode: string;
  edit?: Sale;
  onSaved: (text: string, stay: boolean) => void;
  onBack: () => void;
}) {
  const key = `zhangyuge-draft-${mode}-${edit?.id || "new"}`;
  const [form, setForm] = useState<Draft>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch {}
    return edit ? fromSale(edit) : fresh();
  });
  const { data: products, error: productError } = useQuery<Product[]>(
    api,
    "products.list",
    {},
  );
  const { data: customers } = useQuery<string[]>(api, "customers", {});
  const { data: catalog } = useQuery<Product[]>(api, "products.catalog", {});
  const productGroups = groupProducts(
    (catalog || products || []).filter((p) => p.active),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(form));
      setDirty(
        Boolean(
          form.productName ||
          form.customer ||
          form.revenue ||
          form.cost ||
          form.note ||
          form.date !== today(),
        ),
      );
    } catch {
      setError("浏览器未允许保存草稿，请保持当前页面打开");
    }
  }, [form, key]);
  function change(k: keyof Draft, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function select(p: Product) {
    setForm((f) => ({
      ...f,
      productId: p.id,
      productName: p.name,
      revenue: moneyInput(p.price),
      cost: moneyInput(p.cost),
    }));
  }
  let profit: number | null = null;
  try {
    profit = parseMoney(form.revenue) - parseMoney(form.cost);
  } catch {}
  async function save(stay: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const sale: SaleInput = {
        productId: form.productId,
        productName: form.productName,
        customer: form.customer,
        date: form.date,
        revenue: parseMoney(form.revenue),
        cost: parseMoney(form.cost),
        note: form.note,
      };
      if (edit)
        await api.call("sales.update", {
          id: edit.id,
          revision: edit.revision,
          requestId: form.requestId,
          sale,
        });
      else await api.call("sales.create", { requestId: form.requestId, sale });
      localStorage.removeItem(key);
      if (alive.current) {
        setDirty(false);
        if (stay)
          setForm((f) => ({
            ...fresh(f.date),
            productId: f.productId,
            productName: f.productName,
            revenue: f.revenue,
            cost: f.cost,
          }));
        onSaved(edit ? "记录已更新" : "销售已保存", stay);
      }
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <button className="back-link" onClick={onBack}>
            <ArrowLeft size={15} />
            返回账本
          </button>
          <h1>{edit ? "编辑销售" : "记一笔销售"}</h1>
          <p className="subtle">记下今天的成交，利润自动算好。</p>
        </div>
        <span className="draft-state">
          {dirty ? "未保存 · 草稿已保留在本机" : "准备好，开始记录"}
        </span>
      </div>
      <div className="entry-layout">
        <form
          className="panel entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <section>
            <div className="form-section-title">
              <span>01</span>
              <h2>卖了什么</h2>
            </div>
            <label htmlFor="product-name">
              商品名称<span className="required">*</span>
            </label>
            <select
              aria-label="下拉选择商品"
              value={
                productGroups
                  .flatMap((g) => g.items)
                  .some((p) => p.name === form.productName)
                  ? form.productName
                  : ""
              }
              onChange={(e) => {
                const preset = productGroups
                  .flatMap((g) => g.items)
                  .find((p) => p.name === e.target.value);
                if (preset) select(preset);
              }}
            >
              <option value="">选择商品，或在下方手动输入</option>
              {productGroups.map((g) => (
                <optgroup key={g.category} label={g.category}>
                  {g.items.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input
              id="product-name"
              value={form.productName}
              onChange={(e) => {
                const v = e.target.value;
                const preset = productGroups
                  .flatMap((g) => g.items)
                  .find((p) => p.name === v);
                if (preset) select(preset);
                else setForm((f) => ({ ...f, productName: v, productId: "" }));
              }}
              placeholder="选择常用商品，或直接输入"
              maxLength={200}
              required
              list="product-names"
            />
            <datalist id="product-names">
              {(catalog || products)
                ?.filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
            </datalist>
            <div className="product-chips">
              {products
                ?.filter((p) => p.active)
                .slice(0, 8)
                .map((p) => (
                  <button
                    type="button"
                    className={form.productId === p.id ? "selected" : ""}
                    key={p.id}
                    onClick={() => select(p)}
                  >
                    {p.name}
                  </button>
                ))}
            </div>
            {productError && <ErrorNote>{productError}</ErrorNote>}
            <div className="field-grid">
              <div>
                <label htmlFor="customer">
                  客户名称 <small>选填</small>
                </label>
                <input
                  id="customer"
                  value={form.customer}
                  onChange={(e) => change("customer", e.target.value)}
                  list="customers"
                  placeholder="输入名字，找回熟悉的客户"
                  maxLength={500}
                />
                <datalist id="customers">
                  {[...new Set(customers?.map(displayCustomerName))].map(
                    (c) => (
                      <option key={c} value={c} />
                    ),
                  )}
                </datalist>
              </div>
              <div>
                <label htmlFor="sale-date">
                  成交日期<span className="required">*</span>
                </label>
                <input
                  id="sale-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => change("date", e.target.value)}
                  min="1900-01-01"
                  max="2199-12-31"
                  required
                />
              </div>
            </div>
          </section>
          <section>
            <div className="form-section-title">
              <span>02</span>
              <h2>收入与成本</h2>
            </div>
            <div className="field-grid money-fields">
              <div>
                <label htmlFor="revenue">
                  销售额<span className="required">*</span>
                </label>
                <div className="currency-input">
                  <span>¥</span>
                  <input
                    id="revenue"
                    inputMode="decimal"
                    value={form.revenue}
                    onChange={(e) => change("revenue", e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="cost">
                  成本 / 出资<span className="required">*</span>
                </label>
                <div className="currency-input">
                  <span>¥</span>
                  <input
                    id="cost"
                    inputMode="decimal"
                    value={form.cost}
                    onChange={(e) => change("cost", e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
            </div>
            <div className="profit-preview">
              <span>这笔预计利润</span>
              <strong
                className={profit !== null && profit < 0 ? "negative" : ""}
              >
                ¥ {profit === null ? "—" : money(profit)}
              </strong>
            </div>
          </section>
          <section>
            <label htmlFor="note">
              备注 <small>选填</small>
            </label>
            <textarea
              id="note"
              value={form.note}
              onChange={(e) => change("note", e.target.value)}
              placeholder="例如：续费、优惠、特殊说明…"
              rows={3}
              maxLength={2000}
            />
          </section>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="form-actions">
            <button type="submit" disabled={busy} className="button primary">
              <Check size={17} />
              {busy ? "正在保存…" : edit ? "保存修改" : "保存这笔"}
            </button>
            {!edit && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void save(true)}
              >
                <Plus size={16} />
                保存并继续
              </button>
            )}
          </div>
        </form>
        <aside className="entry-aside">
          <div className="paper-slip">
            <span className="eyebrow">ZHANGYUGE · SALES NOTE</span>
            <h3>
              每一笔，
              <br />
              都值得好好记录。
            </h3>
            <div className="slip-rule" />
            <div>
              <span>销售额</span>
              <strong>¥ {form.revenue || "0.00"}</strong>
            </div>
            <div>
              <span>成本</span>
              <strong>¥ {form.cost || "0.00"}</strong>
            </div>
            <div className="slip-total">
              <span>利润</span>
              <strong>¥ {profit === null ? "—" : money(profit)}</strong>
            </div>
            <p>{form.date.replaceAll("-", " / ")}</p>
          </div>
          <div className="entry-tip">
            <Save size={18} />
            <p>
              输入时自动保留草稿。
              <br />
              保存成功后，云端账本和利润看板一起更新。
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

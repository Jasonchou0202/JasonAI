import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  Plus,
  Save,
  RotateCcw,
} from "lucide-react";
import type { Api, Customer, Product, Sale, SaleInput } from "../domain/model";
import { today } from "../domain/dates";
import { displayCustomerName } from "../domain/customers";
import { money, moneyInput, parseYuan } from "../domain/finance";
import {
  defaultFollowUp,
  findCustomerByName,
  inLunchBreak,
  scheduleText,
  topProfitProducts,
} from "../domain/entryHelpers";
import { QUADRANT_INFO } from "../domain/insights";
import type { EffectiveAction } from "../domain/actions";
import { ActionPicker } from "./ActionLibrary";
import { useInsights } from "../lib/insights-ui";
import { beijingToUTC, customerRoot } from "../lib/customer-ui";
import { useQuery, ErrorNote, message } from "./ui";
import { groupProducts } from "../domain/catalog";
import { ProductEditor } from "./ProductEditor";
type Draft = {
  productId: string;
  productName: string;
  customer: string;
  date: string;
  revenue: string;
  cost: string;
  note: string;
  requestId: string;
  /** 用户手动改过成交日期；没改过时日期始终跟随「今天」（北京时间） */
  dateTouched?: boolean;
  /** 保存后顺手建一条客户日程 */
  schedule?: boolean;
  scheduleAt?: string;
  scheduleTitle?: string;
  scheduleReminder?: "both" | "due" | "off";
  scheduleRequestId?: string;
  /** 顺手建日程时勾选的有效动作（按勾选先后），每行「【色块】动作」 */
  scheduleActions?: { id: string; line: string }[];
};
/** 销售已存、日程还没建成时，留着重试（同一个 requestId，不会重复建） */
interface PendingSchedule {
  customer: string;
  at: string;
  title: string;
  nextAction: string;
  reminder: "both" | "due" | "off";
  requestId: string;
}
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
  onProductSaved,
  onSaved,
  onBack,
}: {
  api: Api;
  mode: string;
  edit?: Sale;
  onProductSaved: () => void;
  onSaved: (text: string, stay: boolean) => void;
  onBack: () => void;
}) {
  const key = `zhangyuge-draft-${mode}-${edit?.id || "new"}`;
  const [form, setForm] = useState<Draft>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const draft: Draft = JSON.parse(saved);
        // 新建时：草稿里的旧日期如果不是手动选的，回到今天
        if (!edit && !draft.dateTouched && draft.date !== today())
          return { ...draft, date: today() };
        return draft;
      }
    } catch {}
    return edit ? fromSale(edit) : fresh();
  });
  // 页面一直开着跨了零点：没手动改过日期就跟着换成新的今天
  useEffect(() => {
    if (edit) return;
    const sync = () =>
      setForm((f) =>
        !f.dateTouched && f.date !== today() ? { ...f, date: today() } : f,
      );
    const timer = setInterval(sync, 60_000);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", sync);
    };
  }, [edit]);
  const [pendingSchedule, setPendingSchedule] = useState<PendingSchedule>();
  const [productVersion, setProductVersion] = useState(0);
  const [addingProduct, setAddingProduct] = useState(false);
  const { data: products, error: productError } = useQuery<Product[]>(
    api,
    "products.list",
    {},
    productVersion,
  );
  const { data: customers } = useQuery<string[]>(api, "customers", {});
  const { data: catalog, error: catalogError } = useQuery<Product[]>(
    api,
    "products.catalog",
    {},
    productVersion,
  );
  const productGroups = groupProducts(
    (catalog || products || []).filter((p) => p.active),
  );
  // 只读：近 3 个月各商品利润合计排前 5（全部有效销售来自看板同一份只读数据）
  const { sales: allSales, insights } = useInsights();
  // 有效动作（方案 A）：按客户名找到档案 → 合并后的主客户 → 所在色块
  const { data: customerList } = useQuery<Customer[]>(
    api,
    "customers.list",
    {},
  );
  const customerHit =
    customerList &&
    findCustomerByName(customerList, form.customer, displayCustomerName);
  const scheduleQuadrants =
    !form.customer.trim() || !customerList || !insights
      ? undefined
      : customerHit
        ? (insights.customerQuadrants.get(
            customerRoot(customerList, customerHit.id),
          ) ?? new Set())
        : new Set<never>();
  const pickedActions = new Set((form.scheduleActions || []).map((a) => a.id));
  function toggleAction(a: EffectiveAction, on: boolean) {
    const line = `【${QUADRANT_INFO[a.quadrant].short}】${a.text}`;
    setForm((f) => {
      const rest = (f.scheduleActions || []).filter((x) => x.id !== a.id);
      return {
        ...f,
        scheduleActions: on ? [...rest, { id: a.id, line }] : rest,
      };
    });
  }
  const activeProducts = (products || []).filter(
    (p) => p.active && !p.archivedAt,
  );
  const ranked = topProfitProducts(allSales, activeProducts, today());
  const quickProducts = [
    ...ranked,
    ...activeProducts.filter((p) => !ranked.includes(p)),
  ].slice(0, 5);
  const [editingDate, setEditingDate] = useState(false);
  const isToday = form.date === today();
  const dateText = isToday ? "今天" : form.date.replaceAll("-", " / ");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lock = useRef(false);
  // 从明细打开编辑时，把焦点交给编辑页标题，键盘和读屏用户知道已进入编辑
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (edit) heading.current?.focus({ preventScroll: true });
  }, [edit?.id]);
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
    setForm((f) => ({
      ...f,
      [k]: v,
      ...(k === "date" ? { dateTouched: true } : {}),
      // 换了客户，色块可能不同，已勾的动作清空重选
      ...(k === "customer" && v.trim() !== f.customer.trim()
        ? { scheduleActions: [] }
        : {}),
    }));
  }
  function toggleSchedule(on: boolean) {
    setForm((f) => ({
      ...f,
      schedule: on,
      scheduleAt: f.scheduleAt || defaultFollowUp(f.date),
      scheduleTitle: f.scheduleTitle ?? "",
      scheduleReminder: f.scheduleReminder || "both",
      scheduleRequestId: f.scheduleRequestId || crypto.randomUUID(),
    }));
  }
  const scheduleTexts = (f: Draft) =>
    scheduleText(
      f.scheduleTitle || "",
      f.productName,
      (f.scheduleActions || []).map((a) => a.line),
    );
  /** 第二步：按客户名找到（合并后的）客户，再建日程；requestId 固定，重试不会重复 */
  async function createSchedule(p: PendingSchedule) {
    const list = await api.call<Customer[]>("customers.list", {});
    const hit = findCustomerByName(list, p.customer, displayCustomerName);
    if (!hit) throw new Error("没找到这位客户的档案");
    await api.call("tasks.create", {
      requestId: p.requestId,
      task: {
        customerId: customerRoot(list, hit.id),
        at: beijingToUTC(p.at),
        title: p.title,
        feedback: "",
        nextAction: p.nextAction || "",
        reminder: p.reminder,
      },
    });
  }
  async function retrySchedule() {
    if (!pendingSchedule || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await createSchedule(pendingSchedule);
      setPendingSchedule(undefined);
      onSaved("客户日程已添加", true);
    } catch (e) {
      setError(`销售已保存，日程还没建成：${message(e)}。可点「重试建日程」。`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function select(p: Product) {
    setForm((f) => ({
      ...f,
      productId: p.id,
      productName: p.name,
      revenue: p.hasDefaultPrice === false ? "" : moneyInput(p.price),
      cost: p.hasDefaultCost === false ? "" : moneyInput(p.cost),
    }));
  }
  let profit: number | null = null;
  try {
    profit =
      parseYuan(form.revenue, edit?.revenue) - parseYuan(form.cost, edit?.cost);
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
        revenue: parseYuan(form.revenue, edit?.revenue),
        cost: parseYuan(form.cost, edit?.cost),
        note: form.note,
      };
      // 日程先在本地校验，不合格就不存销售，免得只存了一半
      const plan: PendingSchedule | undefined =
        !edit && form.schedule
          ? {
              customer: form.customer.trim(),
              at: form.scheduleAt || defaultFollowUp(form.date),
              ...scheduleTexts(form),
              reminder: form.scheduleReminder || "both",
              requestId: form.scheduleRequestId || crypto.randomUUID(),
            }
          : undefined;
      if (plan) {
        if (!plan.customer) throw new Error("新增客户日程需要先填写客户名称");
        beijingToUTC(plan.at);
        if (inLunchBreak(plan.at))
          throw new Error("12:30–14:00 不排日程，请换个时间");
      }
      if (edit)
        await api.call("sales.update", {
          id: edit.id,
          revision: edit.revision,
          requestId: form.requestId,
          sale,
        });
      else await api.call("sales.create", { requestId: form.requestId, sale });
      // 第一步销售已存好；第二步建日程，失败只提示重试，不会重复记销售
      let scheduleError = "";
      if (plan)
        try {
          await createSchedule(plan);
        } catch (e) {
          scheduleError = message(e);
          if (alive.current) setPendingSchedule(plan);
        }
      localStorage.removeItem(key);
      if (alive.current) {
        setDirty(false);
        if (scheduleError) {
          // 留在本页显示重试入口；表单清空，避免误点再存一笔
          setForm(fresh(form.dateTouched ? form.date : today()));
          setError(
            `销售已保存，日程还没建成：${scheduleError}。可点「重试建日程」。`,
          );
          return;
        }
        if (stay)
          setForm((f) => ({
            ...fresh(f.dateTouched ? f.date : today()),
            dateTouched: f.dateTouched,
            productId: f.productId,
            productName: f.productName,
            revenue: f.revenue,
            cost: f.cost,
          }));
        onSaved(
          edit
            ? "记录已更新"
            : plan
              ? "销售已保存，客户日程已添加"
              : "销售已保存",
          stay,
        );
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
          <h1 ref={heading} tabIndex={-1}>
            {edit ? "编辑销售" : "记一笔销售"}
          </h1>
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
            <div className="field-label-row">
              <label htmlFor="product-name">
                商品名称<span className="required">*</span>
              </label>
              <button
                type="button"
                className="text-button add-product-button"
                onClick={() => setAddingProduct(true)}
              >
                <Plus size={15} />
                新增商品
              </button>
            </div>
            <div className="combo-input">
              <input
                id="product-name"
                value={form.productName}
                onChange={(e) => {
                  const v = e.target.value;
                  const preset = productGroups
                    .flatMap((g) => g.items)
                    .find((p) => p.name === v);
                  if (preset) select(preset);
                  else
                    setForm((f) => ({ ...f, productName: v, productId: "" }));
                }}
                placeholder="输入商品名搜索，或点下方常用商品"
                maxLength={200}
                required
                list="product-names"
                autoComplete="off"
              />
              <ComboArrow target="product-name" label="展开商品候选" />
            </div>
            <datalist id="product-names">
              {productGroups.flatMap((g) =>
                g.items.map((p) => (
                  <option key={p.name} value={p.name} label={g.category} />
                )),
              )}
            </datalist>
            {quickProducts.length > 0 && (
              <div
                className="product-chips"
                role="group"
                aria-label="常用商品：近 3 个月利润前 5，从高到低，点一下自动带出售价和成本"
              >
                {quickProducts.map((p) => (
                  <button
                    type="button"
                    className={form.productId === p.id ? "selected" : ""}
                    aria-pressed={form.productId === p.id}
                    key={p.id}
                    onClick={() => select(p)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {(productError || catalogError) && (
              <ErrorNote>{productError || catalogError}</ErrorNote>
            )}
            <div className="customer-field">
              <label htmlFor="customer">
                客户名称 <small>选填</small>
              </label>
              <div className="combo-input">
                <input
                  id="customer"
                  value={form.customer}
                  onChange={(e) => change("customer", e.target.value)}
                  list="customers"
                  placeholder="输入名字，找回熟悉的客户"
                  maxLength={500}
                  autoComplete="off"
                />
                <ComboArrow target="customer" label="展开客户候选" />
              </div>
              <datalist id="customers">
                {[...new Set(customers?.map(displayCustomerName))].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="date-field">
              {editingDate ? (
                <>
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
                    autoFocus
                  />
                </>
              ) : (
                <button
                  type="button"
                  className="date-toggle"
                  aria-label={`成交日期：${dateText}，点击修改`}
                  onClick={() => setEditingDate(true)}
                >
                  <CalendarDays size={15} />
                  <span>成交日期</span>
                  <strong>{dateText}</strong>
                  <span aria-hidden="true">·</span>
                  <em>改</em>
                </button>
              )}
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
                    inputMode="numeric"
                    value={form.revenue}
                    onChange={(e) => change("revenue", e.target.value)}
                    placeholder="0"
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
                    inputMode="numeric"
                    value={form.cost}
                    onChange={(e) => change("cost", e.target.value)}
                    placeholder="0"
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
          {!edit && (
            <section className="entry-schedule">
              <label className="checkbox-label entry-schedule-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(form.schedule)}
                  disabled={!form.customer.trim()}
                  onChange={(e) => toggleSchedule(e.target.checked)}
                />
                <CalendarPlus size={16} aria-hidden="true" />
                新增客户日程
                <small>
                  {form.customer.trim()
                    ? "先保存这笔销售，再给这位客户建一条跟进日程"
                    : "填好客户后可勾选"}
                </small>
              </label>
              {form.schedule && form.customer.trim() && (
                <div className="entry-schedule-fields">
                  <ActionPicker
                    mode={mode}
                    quadrants={scheduleQuadrants}
                    selected={pickedActions}
                    onToggle={toggleAction}
                  />
                  <div>
                    <label htmlFor="schedule-at">跟进时间</label>
                    <input
                      id="schedule-at"
                      type="datetime-local"
                      value={form.scheduleAt || defaultFollowUp(form.date)}
                      onChange={(e) => change("scheduleAt", e.target.value)}
                      required
                    />
                    <small className="entry-schedule-hint">
                      北京时间 · 默认下个月同一天 10:00，没有这一天取月末
                    </small>
                    {inLunchBreak(form.scheduleAt || "") && (
                      <small className="entry-schedule-warn">
                        12:30–14:00 不排日程，请换个时间
                      </small>
                    )}
                  </div>
                  <div>
                    <label htmlFor="schedule-title">要做什么</label>
                    <input
                      id="schedule-title"
                      maxLength={200}
                      value={form.scheduleTitle ?? ""}
                      placeholder={
                        scheduleTexts({ ...form, scheduleTitle: "" }).title
                      }
                      onChange={(e) => change("scheduleTitle", e.target.value)}
                    />
                    {scheduleTexts(form).nextAction && (
                      <small
                        className="entry-schedule-next"
                        data-testid="schedule-next"
                      >
                        下一步：
                        {scheduleTexts(form).nextAction.replaceAll("\n", "；")}
                      </small>
                    )}
                  </div>
                  <div>
                    <label htmlFor="schedule-reminder">提醒</label>
                    <select
                      id="schedule-reminder"
                      value={form.scheduleReminder || "both"}
                      onChange={(e) =>
                        change("scheduleReminder", e.target.value)
                      }
                    >
                      <option value="both">提前提醒 + 到时提醒</option>
                      <option value="due">仅到时提醒</option>
                      <option value="off">关闭提醒</option>
                    </select>
                  </div>
                </div>
              )}
            </section>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          {pendingSchedule && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void retrySchedule()}
            >
              <RotateCcw size={16} />
              重试建日程（{pendingSchedule.customer}）
            </button>
          )}
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
        <aside className="entry-aside" aria-label="本笔小票">
          <div className="paper-slip">
            <span className="eyebrow">章鱼哥 · 本笔小票</span>
            <h3>
              每一笔，
              <br />
              都值得好好记录。
            </h3>
            <div className="slip-rule" />
            <div>
              <span>销售额</span>
              <strong>¥ {form.revenue || "0"}</strong>
            </div>
            <div>
              <span>成本</span>
              <strong>¥ {form.cost || "0"}</strong>
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
      {addingProduct && (
        <ProductEditor
          api={api}
          onClose={() => setAddingProduct(false)}
          onSaved={(p) => {
            select(p);
            setAddingProduct(false);
            setProductVersion((v) => v + 1);
            onProductSaved();
          }}
        />
      )}
    </>
  );
}

/** 下拉小箭头：手机上 datalist 没有箭头，点它聚焦输入框并弹出候选 */
function ComboArrow({ target, label }: { target: string; label: string }) {
  return (
    <button
      type="button"
      className="combo-arrow"
      aria-label={label}
      tabIndex={-1}
      onClick={() => {
        const el = document.getElementById(target) as HTMLInputElement | null;
        if (!el) return;
        el.focus();
        try {
          el.showPicker?.();
        } catch {
          /* 部分浏览器不支持 showPicker，聚焦后系统会给候选 */
        }
      }}
    >
      <ChevronDown size={16} aria-hidden="true" />
    </button>
  );
}

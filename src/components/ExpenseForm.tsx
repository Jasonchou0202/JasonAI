import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Api } from "../domain/model";
import type { ExpenseCategory, ExpenseMeta, ExpenseStatus } from "../domain/expenses";
import { EXPENSE_START_DATE, formatCnDate, OWNER_LABEL, PARTNER_LABEL } from "../domain/expenses";
import { money, parseYuan } from "../domain/finance";
import { today } from "../domain/dates";
import { useTeam } from "../lib/team-ui";
import { ErrorNote, message, useQuery } from "./ui";
import "../expenses.css";

export function ExpenseForm({
  api,
  onSaved,
  onBack,
}: {
  api: Api;
  onSaved: (text: string) => void;
  onBack: () => void;
}) {
  const { me } = useTeam();
  const { data: meta, error: metaError, loading } = useQuery<ExpenseMeta>(api, "expenses.meta", {}, 0);
  const [date, setDate] = useState(() => {
    const t = today();
    return t < EXPENSE_START_DATE ? EXPENSE_START_DATE : t;
  });
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [hasInvoice, setHasInvoice] = useState(false);
  const [status, setStatus] = useState<ExpenseStatus>("pending_reimburse");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [cats, setCats] = useState<ExpenseCategory[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const categories = cats || meta?.categories || [];
  const owner = meta?.owner || { uid: me.ownerUid || me.uid, name: OWNER_LABEL };
  const partner = meta?.partner || { uid: "", name: PARTNER_LABEL };
  const defaultPayer = me.uid === partner.uid ? partner.uid : owner.uid;
  const payer = paidBy || defaultPayer;
  const cat = categories.find((c) => c.id === categoryId);
  const preview = useMemo(() => {
    try {
      return amount ? parseYuan(amount) : 0;
    } catch {
      return 0;
    }
  }, [amount]);
  async function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    setError("");
    try {
      const row = await api.call<ExpenseCategory>("expenses.categories.create", {
        name,
        requestId: crypto.randomUUID(),
      });
      setCats([...(categories.filter((c) => c.id !== row.id)), row]);
      setCategoryId(row.id);
      setNewCat("");
      setAdding(false);
    } catch (e) {
      setError(message(e));
    }
  }
  async function save() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const value = parseYuan(amount);
      await api.call("expenses.create", {
        requestId: crypto.randomUUID(),
        expense: {
          date,
          amount: value,
          categoryId,
          categoryName: cat?.name || "",
          paidBy: payer,
          hasInvoice,
          note,
          status: me.role === "admin" ? status : "pending_confirm",
        },
      });
      onSaved(me.role === "admin" ? "已记下这笔报销" : "已提交，等待确认入账");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const payerName = payer === partner.uid ? partner.name : owner.name;
  const statusLabel = me.role === "admin" ? (status === "reimbursed" ? "已报销" : "待报销") : "待确认";
  if (metaError) return <ErrorNote>{metaError}</ErrorNote>;
  if (loading && !meta) return <p className="subtle">正在打开…</p>;
  return (
    <div className="exp-form">
      <div className="page-heading">
        <div>
          <button className="back-link" type="button" onClick={onBack}>
            <ArrowLeft size={15} />
            返回报销记账
          </button>
          <h1>记一笔报销</h1>
          <p className="subtle exp-form-lead">从报销记账进入。进货成本从销售记录带出，不必重复记。</p>
        </div>
      </div>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="exp-fields">
          <div>
            <label htmlFor="exp-date">日期</label>
            <div className="exp-date-field">
              <span className="exp-date-display" aria-hidden="true">
                {date ? `${date.slice(0, 4)} / ${date.slice(5, 7)} / ${date.slice(8, 10)}` : ""}
              </span>
              <input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value < EXPENSE_START_DATE ? EXPENSE_START_DATE : e.target.value)} required min={EXPENSE_START_DATE} max="2199-12-31" />
            </div>
            <p className="exp-date-hint">从 {formatCnDate(EXPENSE_START_DATE)}起记，不能选更早的日期</p>
          </div>
          <div>
            <label htmlFor="exp-amount">金额</label>
            <div className="currency-input exp-amount">
              <span>¥</span>
              <input id="exp-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" required />
            </div>
          </div>
        </div>
        <div className="exp-block">
          <label>
            分类 <small>选一个，也可自己添加</small>
          </label>
          <div className="exp-chips" role="group" aria-label="分类">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${c.hint ? "tall" : ""} ${categoryId === c.id ? "selected" : ""}`}
                aria-pressed={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
              >
                {c.name}
                {c.hint ? <small>{c.hint}</small> : null}
              </button>
            ))}
            <button type="button" className="add" onClick={() => setAdding((v) => !v)}>
              + 添加分类
            </button>
          </div>
          {adding && (
            <div className="exp-add-cat">
              <input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                placeholder="例如：招待"
                maxLength={40}
                autoFocus
              />
              <button type="button" className="button" onClick={() => void addCategory()}>
                添加
              </button>
            </div>
          )}
        </div>
        <div className="exp-block">
          <label>谁出的钱</label>
          <div className="exp-chips exp-pair" role="group" aria-label="谁出的钱">
            <button type="button" className={payer === owner.uid ? "selected" : ""} aria-pressed={payer === owner.uid} onClick={() => setPaidBy(owner.uid)}>
              {owner.name}
            </button>
            <button type="button" className={payer === partner.uid ? "selected" : ""} aria-pressed={payer === partner.uid} onClick={() => setPaidBy(partner.uid)} disabled={!partner.uid}>
              {partner.name}
            </button>
          </div>
        </div>
        <div className="exp-pair exp-block">
          <div>
            <label>有无发票</label>
            <div className="exp-chips" role="group" aria-label="有无发票">
              <button type="button" className={hasInvoice ? "selected" : ""} aria-pressed={hasInvoice} onClick={() => setHasInvoice(true)}>有</button>
              <button type="button" className={!hasInvoice ? "selected" : ""} aria-pressed={!hasInvoice} onClick={() => setHasInvoice(false)}>无</button>
            </div>
          </div>
          {me.role === "admin" && (
            <div>
              <label>状态</label>
              <div className="exp-chips" role="group" aria-label="状态">
                <button type="button" className={status === "pending_reimburse" ? "selected" : ""} aria-pressed={status === "pending_reimburse"} onClick={() => setStatus("pending_reimburse")}>待报销</button>
                <button type="button" className={status === "reimbursed" ? "selected" : ""} aria-pressed={status === "reimbursed"} onClick={() => setStatus("reimbursed")}>已报销</button>
              </div>
            </div>
          )}
        </div>
        <div className="exp-block">
          <label htmlFor="exp-note">
            备注 <small>选填</small>
          </label>
          <textarea id="exp-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="例如：Claude、ChatGPT 十一月订阅" />
        </div>
        {preview > 0 && cat && (
          <div className="exp-summary">
            <div>
              记入 {Number(date.slice(5, 7))} 月报销
              <div>
                {cat.name} · {payerName}垫付 · {statusLabel}
              </div>
            </div>
            <b>¥{money(preview)}</b>
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <button className="exp-submit" disabled={busy || !categoryId}>
          {busy ? "正在保存…" : "记下来"}
        </button>
      </form>
    </div>
  );
}

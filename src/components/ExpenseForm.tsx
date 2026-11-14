import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CreditCard, FileText, Paperclip, ReceiptText, X } from "lucide-react";
import type { Api } from "../domain/model";
import type { ExpenseCategory, ExpenseMeta, ExpenseReceipt, ExpenseStatus, ReceiptKind } from "../domain/expenses";
import {
  EXPENSE_START_DATE,
  formatCnDate,
  OWNER_LABEL,
  PARTNER_LABEL,
  RECEIPT_ACCEPT,
  RECEIPT_KIND_LABEL,
  RECEIPT_MAX_FILES,
  deriveHasInvoice,
  receiptMime,
} from "../domain/expenses";
import { money, parseYuan } from "../domain/finance";
import { today } from "../domain/dates";
import { useTeam } from "../lib/team-ui";
import { checkReceiptFile, sizeLabel, uploadReceipts } from "../lib/receipt-upload";
import { ErrorNote, message, useQuery } from "./ui";
import "../expenses.css";

interface Picked {
  key: string;
  file: File;
  kind: ReceiptKind;
  /** 图片缩略图（本机临时地址）；PDF、HEIC 显示图标 */
  thumb: string | null;
  /** 已传到云存储（保存失败重试时不再重复上传） */
  uploaded?: ExpenseReceipt;
}

const KIND_BUTTONS: { kind: ReceiptKind; label: string; icon: typeof FileText }[] = [
  { kind: "invoice", label: "上传发票", icon: ReceiptText },
  { kind: "no_invoice", label: "无发票说明", icon: FileText },
  { kind: "payment", label: "支付凭证", icon: CreditCard },
];

const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  const [files, setFiles] = useState<Picked[]>([]);
  const [fileError, setFileError] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(
    () => () => {
      for (const f of filesRef.current) if (f.thumb) URL.revokeObjectURL(f.thumb);
    },
    [],
  );
  const receiptsEnabled = !!meta?.receiptsEnabled;
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
  const invoiceNow = receiptsEnabled
    ? deriveHasInvoice(files.map((f) => ({ kind: f.kind }) as ExpenseReceipt), false)
    : hasInvoice;
  function pick(kind: ReceiptKind, list: FileList | null) {
    if (!list?.length) return;
    setFileError("");
    const next: Picked[] = [];
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      const bad = checkReceiptFile(file);
      if (bad) {
        problems.push(bad);
        continue;
      }
      if (files.length + next.length >= RECEIPT_MAX_FILES) {
        problems.push(`一笔最多 ${RECEIPT_MAX_FILES} 个凭证`);
        break;
      }
      const mime = receiptMime(file.name, file.type);
      next.push({
        key: crypto.randomUUID(),
        file,
        kind,
        thumb: mime && PREVIEWABLE.has(mime) ? URL.createObjectURL(file) : null,
      });
    }
    if (problems.length) setFileError(problems.join("；"));
    if (next.length) setFiles((old) => [...old, ...next]);
  }
  function removeFile(key: string) {
    const f = files.find((x) => x.key === key);
    if (!f) return;
    if (f.thumb) URL.revokeObjectURL(f.thumb);
    if (f.uploaded) void api.call("expenses.receipts.discard", { fileIDs: [f.uploaded.fileID] }).catch(() => undefined);
    setFiles((old) => old.filter((x) => x.key !== key));
  }
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
      let receipts: ExpenseReceipt[] = [];
      if (receiptsEnabled && files.length) {
        const todo = files.filter((f) => !f.uploaded);
        if (todo.length) {
          setProgress(`正在上传凭证 0/${todo.length}…`);
          const done = await uploadReceipts(api, todo, (n) => setProgress(`正在上传凭证 ${n}/${todo.length}…`));
          const byKey = new Map(todo.map((f, i) => [f.key, done[i]]));
          const merged = files.map((f) => (byKey.has(f.key) ? { ...f, uploaded: byKey.get(f.key) } : f));
          setFiles(merged);
          receipts = merged.map((f) => ({ ...f.uploaded!, kind: f.kind }));
        } else {
          receipts = files.map((f) => ({ ...f.uploaded!, kind: f.kind }));
        }
        setProgress("正在保存…");
      }
      await api.call("expenses.create", {
        requestId: requestId.current,
        expense: {
          date,
          amount: value,
          categoryId,
          categoryName: cat?.name || "",
          paidBy: payer,
          hasInvoice: receiptsEnabled ? deriveHasInvoice(receipts, false) : hasInvoice,
          ...(receipts.length ? { receipts } : {}),
          note,
          status: me.role === "admin" ? status : "pending_confirm",
        },
      });
      onSaved(me.role === "admin" ? "已记下这笔报销" : "已提交，等待确认入账");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      setProgress("");
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
        className="exp-form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="panel exp-form-main" aria-label="报销信息">
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
              <div className="exp-amount">
                <span className="exp-amount-prefix" aria-hidden="true">¥</span>
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
          <div className={`exp-block ${me.role === "admin" ? "exp-pair" : ""}`}>
            <div>
              <label>谁出的钱</label>
              <div className="exp-chips exp-pair-chips" role="group" aria-label="谁出的钱">
                <button type="button" className={payer === owner.uid ? "selected" : ""} aria-pressed={payer === owner.uid} onClick={() => setPaidBy(owner.uid)}>
                  {owner.name}
                </button>
                <button type="button" className={payer === partner.uid ? "selected" : ""} aria-pressed={payer === partner.uid} onClick={() => setPaidBy(partner.uid)} disabled={!partner.uid}>
                  {partner.name}
                </button>
              </div>
            </div>
            {me.role === "admin" && (
              <div>
                <label>状态</label>
                <div className="exp-chips exp-pair-chips" role="group" aria-label="状态">
                  <button type="button" className={status === "pending_reimburse" ? "selected" : ""} aria-pressed={status === "pending_reimburse"} onClick={() => setStatus("pending_reimburse")}>待报销</button>
                  <button type="button" className={status === "reimbursed" ? "selected" : ""} aria-pressed={status === "reimbursed"} onClick={() => setStatus("reimbursed")}>已报销</button>
                </div>
              </div>
            )}
          </div>
          <div className="exp-block exp-note-block">
            <label htmlFor="exp-note">
              备注 <small>选填</small>
            </label>
            <textarea id="exp-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="例如：十一月话费、见客户打车" />
          </div>
        </section>
        <aside className="exp-form-side">
          <section className="panel exp-receipts" aria-label="凭证">
            <div className="exp-receipts-head">
              <label>
                凭证 <small>发票、无发票说明或支付截图</small>
              </label>
              <span className="exp-receipts-rule">PDF、JPG、PNG、HEIC、WebP · 单个 ≤10MB · 最多 {RECEIPT_MAX_FILES} 个</span>
            </div>
            <div className="exp-receipt-kinds" role="group" aria-label="上传凭证">
              {KIND_BUTTONS.map(({ kind, label, icon: Icon }) => (
                <label key={kind} className={`exp-receipt-kind ${receiptsEnabled ? "" : "disabled"}`} aria-disabled={!receiptsEnabled}>
                  <Icon size={18} />
                  <span>{label}</span>
                  <input
                    type="file"
                    accept={RECEIPT_ACCEPT}
                    multiple
                    disabled={!receiptsEnabled || busy}
                    aria-label={label}
                    onChange={(e) => {
                      pick(kind, e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              ))}
            </div>
            {!receiptsEnabled && (
              <div className="exp-receipt-soon">
                <p>上传功能即将开放。开放前先在这里标一下有没有发票：</p>
                <div className="exp-chips exp-pair-chips" role="group" aria-label="有无发票">
                  <button type="button" className={hasInvoice ? "selected" : ""} aria-pressed={hasInvoice} onClick={() => setHasInvoice(true)}>有发票</button>
                  <button type="button" className={!hasInvoice ? "selected" : ""} aria-pressed={!hasInvoice} onClick={() => setHasInvoice(false)}>无发票</button>
                </div>
              </div>
            )}
            {receiptsEnabled && files.length === 0 && (
              <p className="exp-receipt-empty">
                <Paperclip size={15} /> 还没有凭证。有发票传发票；没有发票就传无发票说明或支付截图。
              </p>
            )}
            {files.length > 0 && (
              <ul className="exp-receipt-list">
                {files.map((f) => (
                  <li key={f.key} className="exp-receipt-item">
                    <span className={`exp-receipt-thumb ${f.thumb ? "" : "icon"}`}>
                      {f.thumb ? <img src={f.thumb} alt="" /> : <FileText size={20} />}
                    </span>
                    <span className="exp-receipt-meta">
                      <strong title={f.file.name}>{f.file.name}</strong>
                      <small>
                        <em className={`exp-receipt-tag ${f.kind}`}>{RECEIPT_KIND_LABEL[f.kind]}</em>
                        {sizeLabel(f.file.size)}
                        {f.uploaded ? " · 已上传" : ""}
                      </small>
                    </span>
                    <button type="button" className="exp-receipt-remove" aria-label={`删除${f.file.name}`} onClick={() => removeFile(f.key)} disabled={busy}>
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {fileError && <p className="exp-receipt-error" role="alert">{fileError}</p>}
          </section>
          <section className="panel exp-form-submit">
            {preview > 0 && cat ? (
              <div className="exp-summary">
                <div>
                  记入 {Number(date.slice(5, 7))} 月报销
                  <div>
                    {cat.name} · {payerName}垫付 · {statusLabel} · {invoiceNow ? "有发票" : "无发票"}
                  </div>
                </div>
                <b>¥{money(preview)}</b>
              </div>
            ) : (
              <p className="exp-summary-empty">填好金额并选一个分类后，这里会显示记入哪个月。</p>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
            <button className="exp-submit" disabled={busy || !categoryId}>
              {busy ? progress || "正在保存…" : "记下来"}
            </button>
          </section>
        </aside>
      </form>
    </div>
  );
}

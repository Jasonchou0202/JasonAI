/**
 * 普票开票管理（INVOICE_ENABLED 开时才出现）：开票页、客户卡「开票信息」、销售记录「需要开票」开关、开票录入。
 * 关着时这些组件都不渲染，界面与现在一致。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, FileText, Paperclip, Pencil, Upload, X, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Api, Sale } from "../domain/model";
import { displayCustomerName } from "../domain/customers";
import { today } from "../domain/dates";
import {
  FIELD_KEYS,
  FIELD_LABEL,
  INVOICE_ACCEPT,
  INVOICE_FILE_MAX_BYTES,
  INVOICE_STATUSES,
  INVOICE_STATUS_LABEL,
  INVOICE_TYPE_LABEL,
  OPEN_STATUSES,
  PROFILE_ACCEPT,
  invoiceFileMime,
  type InvoiceFields,
  type InvoiceFile,
  type InvoiceFilePurpose,
  type InvoiceListResult,
  type InvoiceProfileView,
  type InvoiceRecord,
  type InvoiceRow,
  type InvoiceStatus,
} from "../domain/invoices";
import { ErrorNote, Modal, message, useQuery } from "./ui";
import "../invoices.css";

/** 发票金额：整元不带小数，有角分时显示两位 */
export function invoiceMoney(cents: number): string {
  const yuan = cents / 100;
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(yuan);
}
export function parseInvoiceAmount(text: string): number {
  const s = text.trim().replace(/^[¥￥]\s*/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("开票金额填数字，最多两位小数");
  const cents = Math.round(Number(s) * 100);
  if (cents <= 0) throw new Error("开票金额要大于 0");
  return cents;
}

export function StatusChip({ status }: { status: InvoiceStatus }) {
  return <span className={`inv-chip s-${status}`}>{INVOICE_STATUS_LABEL[status]}</span>;
}
export function ProfileBadge({ complete }: { complete: boolean }) {
  return complete ? (
    <span className="inv-badge ok"><CheckCircle2 size={13} />资料齐</span>
  ) : (
    <span className="inv-badge missing"><AlertCircle size={13} />缺资料</span>
  );
}

async function toBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function FilePicker({
  api,
  files,
  onChange,
  purpose,
  enabled,
}: {
  api: Api;
  files: InvoiceFile[];
  onChange: (f: InvoiceFile[]) => void;
  purpose: InvoiceFilePurpose;
  enabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accept = purpose === "invoice" ? INVOICE_ACCEPT : PROFILE_ACCEPT;
  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setError("");
    setBusy(true);
    const next = [...files];
    try {
      for (const file of Array.from(list)) {
        const mime = invoiceFileMime(file.name);
        if (!mime || !accept.includes("." + file.name.split(".").pop()!.toLowerCase())) throw new Error(`「${file.name}」类型不支持`);
        if (file.size > INVOICE_FILE_MAX_BYTES) throw new Error(`「${file.name}」超过 4MB`);
        const f = await api.call<InvoiceFile>("invoices.files.upload", { name: file.name, purpose, data: await toBase64(file) });
        next.push(f);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      onChange(next);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="inv-files">
      {files.map((f) => (
        <span className="inv-file" key={f.fileID}>
          <Paperclip size={13} />
          <span className="inv-file-name">{f.name}</span>
          <button type="button" aria-label={`移除${f.name}`} onClick={() => onChange(files.filter((x) => x.fileID !== f.fileID))}>
            <X size={13} />
          </button>
        </span>
      ))}
      {enabled ? (
        <>
          <button type="button" className="inv-upload" disabled={busy} onClick={() => input.current?.click()}>
            <Upload size={14} />
            {busy ? "正在上传…" : purpose === "invoice" ? "附上发票 PDF 或图片" : "上传文件"}
          </button>
          <input ref={input} type="file" hidden multiple accept={accept} onChange={(e) => void pick(e.target.files)} />
          <small className="inv-hint">{purpose === "invoice" ? "PDF、PNG、JPG，单个 ≤ 4MB" : "PDF、Word、txt、PNG、JPG，单个 ≤ 4MB；只存原件，不识别内容"}</small>
        </>
      ) : (
        <small className="inv-hint">附件上传尚未开放</small>
      )}
      {error && <small className="inv-error">{error}</small>}
    </div>
  );
}

/* ───────── 客户卡「开票信息」 ───────── */

export function InvoiceProfileCard({ api, customerId, onSaved }: { api: Api; customerId: string; onSaved?: (msg: string) => void }) {
  const [v, setV] = useState(0);
  const { data, error } = useQuery<InvoiceProfileView>(api, "invoices.profile.get", { customerId }, v);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return null;
  const f = data.profile?.fields || {};
  const filled = FIELD_KEYS.filter((k) => f[k]);
  return (
    <section className="panel inv-card" aria-label="开票信息">
      <header className="inv-card-head">
        <div>
          <h2>开票信息</h2>
          <p>{INVOICE_TYPE_LABEL} · 每个客户一套{data.open ? ` · 有 ${data.open} 笔还没开` : ""}</p>
        </div>
        <ProfileBadge complete={data.complete} />
      </header>
      {data.profile ? (
        <div className="inv-card-body">
          {filled.length > 0 && (
            <dl className="inv-fields">
              {filled.map((k) => (
                <div key={k}>
                  <dt>{FIELD_LABEL[k]}</dt>
                  <dd>{f[k]}</dd>
                </div>
              ))}
            </dl>
          )}
          {data.profile.text && <pre className="inv-text">{data.profile.text}</pre>}
          {data.profile.files.length > 0 && <FileLinks api={api} id={data.profile.id} files={data.profile.files} />}
        </div>
      ) : (
        <p className="inv-empty">还没有开票资料。可以直接粘贴客户发来的文字，或上传 PDF、Word、图片。</p>
      )}
      {!data.complete && <p className="inv-missing-note">缺资料：至少填抬头和税号，或粘贴原文、上传文件。</p>}
      <div className="inv-card-actions">
        <button type="button" className="button secondary" onClick={() => setEditing(true)}>
          <Pencil size={15} />
          {data.profile ? "编辑开票信息" : "添加开票信息"}
        </button>
      </div>
      {editing && (
        <ProfileEditor
          api={api}
          view={data}
          onClose={() => setEditing(false)}
          onSaved={(moved) => {
            setEditing(false);
            setV((x) => x + 1);
            onSaved?.(moved ? `开票信息已保存，${moved} 笔转为待开票` : "开票信息已保存");
          }}
        />
      )}
    </section>
  );
}

function FileLinks({ api, id, files }: { api: Api; id: string; files: InvoiceFile[] }) {
  const [busy, setBusy] = useState(false);
  async function open(i: number) {
    setBusy(true);
    try {
      const r = await api.call<{ items: { url: string | null }[] }>("invoices.files.urls", { id });
      const url = r.items[i]?.url;
      if (url) window.open(url, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inv-files">
      {files.map((f, i) => (
        <button type="button" className="inv-file link" key={f.fileID} disabled={busy} onClick={() => void open(i)}>
          <FileText size={13} />
          <span className="inv-file-name">{f.name}</span>
        </button>
      ))}
    </div>
  );
}

function ProfileEditor({ api, view, onClose, onSaved }: { api: Api; view: InvoiceProfileView; onClose: () => void; onSaved: (moved: number) => void }) {
  const p = view.profile;
  const [text, setText] = useState(p?.text || "");
  const [fields, setFields] = useState<InvoiceFields>(p?.fields || {});
  const [files, setFiles] = useState<InvoiceFile[]>(p?.files || []);
  const [mode, setMode] = useState<"text" | "fields">(p && !p.text && Object.keys(p.fields).length ? "fields" : "text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api.call<{ moved: number }>("invoices.profile.save", { customerId: view.customerId, revision: p?.revision ?? 0, text, fields, files });
      onSaved(r.moved);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="开票信息" onClose={onClose}>
      <div className="inv-form">
        <div className="inv-seg" role="group" aria-label="录入方式">
          <button type="button" className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>粘贴文字</button>
          <button type="button" className={mode === "fields" ? "active" : ""} onClick={() => setMode("fields")}>逐项填写</button>
        </div>
        {mode === "text" ? (
          <label className="inv-field">
            <span>客户发来的开票资料</span>
            <textarea
              id="inv-profile-text"
              rows={6}
              value={text}
              placeholder={"名称：\n税号：\n地址电话：\n开户行及账号：\n收票邮箱："}
              onChange={(e) => setText(e.target.value)}
            />
            <small className="inv-hint">原样保存，不自动识别；抬头取第一行。</small>
          </label>
        ) : (
          <div className="inv-grid inv-profile-grid">
            {FIELD_KEYS.map((k) => (
              <label className={`inv-field ${k === "title" || k === "bankAccount" || k === "addressPhone" ? "wide" : ""}`} key={k}>
                <span>{FIELD_LABEL[k]}{k === "title" || k === "taxNo" ? "" : "（可不填）"}</span>
                <input
                  id={`inv-f-${k}`}
                  value={fields[k] || ""}
                  inputMode={k === "email" ? "email" : "text"}
                  autoCapitalize={k === "taxNo" ? "characters" : "off"}
                  onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
                />
              </label>
            ))}
          </div>
        )}
        <div className="inv-field">
          <span>附件</span>
          <FilePicker api={api} files={files} onChange={setFiles} purpose="profile" enabled={view.filesEnabled} />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="inv-actions">
          <button type="button" className="button secondary" onClick={onClose}>取消</button>
          <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>{busy ? "正在保存…" : "保存"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────── 开票录入（改状态、号码、日期、附件、寄送） ───────── */

export function InvoiceEditor({ api, record, filesEnabled, onClose, onSaved }: { api: Api; record: InvoiceRecord; filesEnabled: boolean; onClose: () => void; onSaved: (r: InvoiceRecord, msg: string) => void }) {
  const [status, setStatus] = useState<InvoiceStatus>(record.status);
  const [amount, setAmount] = useState(String(record.amount / 100));
  const [title, setTitle] = useState(record.title);
  const [invoiceNo, setInvoiceNo] = useState(record.invoiceNo || "");
  const [issuedOn, setIssuedOn] = useState(record.issuedOn || today());
  const [sentTo, setSentTo] = useState(record.sentTo || "");
  const [files, setFiles] = useState<InvoiceFile[]>(record.files || []);
  const [note, setNote] = useState(record.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = record.status === "void" || record.status === "red";
  const issued = status === "issued" || status === "sent" || status === "void" || status === "red";
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api.call<{ record: InvoiceRecord }>("invoices.update", {
        id: record.id,
        revision: record.revision,
        status,
        amount: parseInvoiceAmount(amount),
        title,
        ...(issued ? { invoiceNo, issuedOn } : {}),
        ...(status === "sent" ? { sentTo } : {}),
        files,
        note,
      });
      onSaved(r.record, `已保存 · ${INVOICE_STATUS_LABEL[r.record.status]}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="开票" onClose={onClose}>
      <div className="inv-form">
        <div className="inv-sale-line">
          <strong>{displayCustomerName(record.customerName) || "未填写客户"}</strong>
          <span>{record.productName} · {record.saleDate.replaceAll("-", ".")} · 销售额 ¥{invoiceMoney(record.saleRevenue)}</span>
        </div>
        <div className="inv-field">
          <span>状态</span>
          <div className="inv-steps" role="radiogroup" aria-label="开票状态">
            {INVOICE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                disabled={locked}
                className={`inv-step s-${s} ${status === s ? "active" : ""}`}
                onClick={() => setStatus(s)}
              >
                {s === "void" ? "作废" : s === "red" ? "红冲" : INVOICE_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="inv-grid">
          <label className="inv-field">
            <span>票种</span>
            <input value={INVOICE_TYPE_LABEL} readOnly aria-readonly />
          </label>
          <label className="inv-field">
            <span>开票金额（元）</span>
            <input id="inv-amount" inputMode="decimal" value={amount} disabled={locked} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="inv-field wide">
            <span>抬头</span>
            <input id="inv-title" value={title} disabled={locked} placeholder="从客户开票信息自动带上" onChange={(e) => setTitle(e.target.value)} />
          </label>
          {issued && (
            <>
              <label className="inv-field inv-no">
                <span>发票号码</span>
                <input id="inv-no" inputMode="numeric" value={invoiceNo} disabled={locked} onChange={(e) => setInvoiceNo(e.target.value)} />
              </label>
              <label className="inv-field">
                <span>开票日期</span>
                <input id="inv-date" type="date" value={issuedOn} disabled={locked} onChange={(e) => setIssuedOn(e.target.value)} />
              </label>
            </>
          )}
          {status === "sent" && (
            <label className="inv-field wide">
              <span>寄到哪里（邮箱或快递单号）</span>
              <input id="inv-sent" value={sentTo} disabled={locked} onChange={(e) => setSentTo(e.target.value)} />
            </label>
          )}
        </div>
        {issued && (
          <div className="inv-field">
            <span>发票原件</span>
            <FilePicker api={api} files={files} onChange={setFiles} purpose="invoice" enabled={filesEnabled && !locked} />
          </div>
        )}
        <label className="inv-field">
          <span>备注（可不填）</span>
          <input value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />
        </label>
        {status === "pending" && record.status !== "pending" && <p className="inv-hint">待开票 3 天没动，会在你的日程里提醒。</p>}
        {locked && <p className="inv-hint">已作废或红冲的发票不能再改。</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="inv-actions">
          <button type="button" className="button secondary" onClick={onClose}>取消</button>
          {!locked && (
            <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>{busy ? "正在保存…" : "保存"}</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ───────── 销售记录「需要开票」开关 ───────── */

export interface SaleInvoiceInfo {
  id: string;
  status: InvoiceStatus;
  amount: number;
  revision: number;
  profileComplete: boolean;
}

export function useSaleInvoices(api: Api, on: boolean, saleIds: string[], version: number) {
  const [tick, setTick] = useState(0);
  const { data } = useQuery<Record<string, SaleInvoiceInfo>>(
    on && saleIds.length ? api : NOOP,
    "invoices.forSales",
    { ids: saleIds },
    version + tick,
  );
  return { map: data || {}, reload: () => setTick((t) => t + 1) };
}
const NOOP: Api = { call: async <T,>() => ({}) as T };

export function SaleInvoiceSwitch({
  api,
  sale,
  info,
  onChanged,
  compact,
}: {
  api: Api;
  sale: Pick<Sale, "id" | "revenue">;
  info?: SaleInvoiceInfo;
  onChanged: (msg: string) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<InvoiceRecord | null>(null);
  const [filesEnabled, setFilesEnabled] = useState(false);
  const on = !!info;
  const canOff = !info || OPEN_STATUSES.includes(info.status);
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      if (on) {
        await api.call("invoices.toggle", { saleId: sale.id, on: false });
        onChanged("已取消开票");
      } else {
        const r = await api.call<{ record: InvoiceRecord }>("invoices.toggle", { saleId: sale.id, on: true });
        onChanged(r.record.status === "pending" ? "已加入待开票" : "已加入开票，等客户资料");
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function edit() {
    setBusy(true);
    try {
      const r = await api.call<InvoiceListResult>("invoices.list", { month: "all" });
      const row = r.items.find((x) => x.saleId === sale.id);
      setFilesEnabled(r.filesEnabled);
      if (row) setEditing(row);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`inv-switch ${compact ? "compact" : ""}`} onClick={(e) => e.stopPropagation()}>
      <label className="inv-toggle" title={canOff ? "" : "已开出的发票不能取消，请改为作废或红冲"}>
        <input type="checkbox" role="switch" checked={on} disabled={busy || !canOff} onChange={() => void toggle()} aria-label="需要开票" />
        <i aria-hidden />
        <span>需要开票</span>
      </label>
      {info && (
        <button type="button" className="inv-switch-status" onClick={() => void edit()} disabled={busy} aria-label={`开票：${INVOICE_STATUS_LABEL[info.status]}，点按编辑`}>
          <StatusChip status={info.status} />
          {!compact && <span className="inv-switch-amount">¥{invoiceMoney(info.amount)}</span>}
          <Pencil size={13} />
        </button>
      )}
      {error && <small className="inv-error">{error}</small>}
      {editing && (
        <InvoiceEditor
          api={api}
          record={editing}
          filesEnabled={filesEnabled}
          onClose={() => setEditing(null)}
          onSaved={(_, msg) => {
            setEditing(null);
            onChanged(msg);
          }}
        />
      )}
    </div>
  );
}

/* ───────── 开票页 ───────── */

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const FILTERS: { id: string; label: string }[] = [
  { id: "", label: "全部" },
  { id: "open", label: "未开" },
  ...INVOICE_STATUSES.map((s) => ({ id: s, label: INVOICE_STATUS_LABEL[s] })),
];

export function InvoicesPage({
  api,
  version,
  month,
  onMonth,
  onCustomer,
  onChanged,
}: {
  api: Api;
  version: number;
  month: string;
  onMonth: (m: string) => void;
  onCustomer: (id: string) => void;
  onChanged: (msg: string) => void;
}) {
  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [tick, setTick] = useState(0);
  const { data, error, loading } = useQuery<InvoiceListResult>(api, "invoices.list", { month, ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) }, version + tick);
  const [editing, setEditing] = useState<InvoiceRow | null>(null);
  const [y, m] = month.split("-");
  useEffect(() => setEditing(null), [month]);
  const stats = data?.stats;
  return (
    <div className="inv-page">
      <div className="exp-heading">
        <div>
          <h1>开票</h1>
          <p>只管增值税普通发票：谁缺资料、哪些还没开、开到哪一步。数字跟着月份走。</p>
        </div>
        <div className="exp-heading-actions">
          <div className="exp-month-nav" aria-label="切换月份">
            <button type="button" aria-label="上个月" onClick={() => onMonth(shiftMonth(month, -1))}>
              <ChevronLeft size={16} />
            </button>
            <strong>{y} 年 {Number(m)} 月</strong>
            <button type="button" aria-label="下个月" onClick={() => onMonth(shiftMonth(month, 1))}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <section className="inv-stats" aria-label="本月开票概况">
        <Stat label="待开票" value={stats ? `${stats.pending.count} 笔` : "—"} sub={stats ? `¥${invoiceMoney(stats.pending.amount)}${stats.pending.awaiting ? ` · 其中 ${stats.pending.awaiting} 笔待收资料` : ""}` : ""} onClick={() => setStatus("open")} />
        <Stat label="已开票" value={stats ? `${stats.issued.count} 笔` : "—"} sub={stats ? `¥${invoiceMoney(stats.issued.amount)} · 按开票日期` : ""} onClick={() => setStatus("issued")} />
        <Stat label="缺资料的客户" value={stats ? `${stats.missingCustomers} 位` : "—"} sub="补齐后自动转为待开票" warn={!!stats?.missingCustomers} onClick={() => setStatus("awaiting_info")} />
      </section>
      <section className="panel inv-list-panel">
        <div className="inv-filters">
          <div className="inv-chips" role="group" aria-label="按状态筛选">
            {FILTERS.map((f) => (
              <button key={f.id || "all"} type="button" className={status === f.id ? "active" : ""} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <select aria-label="按客户筛选" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">全部客户</option>
            {(data?.customers || []).map((c) => (
              <option key={c.id} value={c.id}>{displayCustomerName(c.name)}</option>
            ))}
          </select>
        </div>
        {loading && !data ? (
          <p className="subtle">正在读取开票记录…</p>
        ) : !data?.items.length ? (
          <p className="inv-empty">这个月没有要开票的记录。在销售明细里打开「需要开票」，就会出现在这里。</p>
        ) : (
          <ul className="inv-list">
            {data.items.map((r) => (
              <li key={r.id} className={`inv-row s-${r.status}`}>
                <button type="button" className="inv-row-main" onClick={() => setEditing(r)} aria-label={`编辑开票：${displayCustomerName(r.customerName)}`}>
                  <span className="inv-row-who">
                    <strong>{displayCustomerName(r.customerName) || "未填写客户"}</strong>
                    {OPEN_STATUSES.includes(r.status) && <ProfileBadge complete={r.profileComplete} />}
                  </span>
                  <span className="inv-row-meta">
                    {r.saleDate.slice(5).replace("-", "/")} · {r.productName}
                    {r.invoiceNo ? ` · No.${r.invoiceNo.slice(-8)}` : ""}
                    {r.status === "sent" && r.sentTo ? ` · 寄 ${r.sentTo}` : ""}
                  </span>
                </button>
                <b className="inv-row-amount">¥{invoiceMoney(r.amount)}</b>
                <QuickStatus api={api} row={r} onDone={(msg) => { setTick((t) => t + 1); onChanged(msg); }} onNeedDetails={() => setEditing(r)} />
                {r.customerId && (
                  <button type="button" className="text-button inv-row-customer" onClick={() => onCustomer(r.customerId)}>客户卡</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && (
        <InvoiceEditor
          api={api}
          record={editing}
          filesEnabled={!!data?.filesEnabled}
          onClose={() => setEditing(null)}
          onSaved={(_, msg) => {
            setEditing(null);
            setTick((t) => t + 1);
            onChanged(msg);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, sub, warn, onClick }: { label: string; value: string; sub: ReactNode; warn?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`inv-stat ${warn ? "warn" : ""}`} onClick={onClick}>
      <small>{label}</small>
      <b>{value}</b>
      <span>{sub}</span>
    </button>
  );
}

/** 列表里直接改状态：下一步一键；要填号码等信息时打开录入 */
function QuickStatus({ api, row, onDone, onNeedDetails }: { api: Api; row: InvoiceRow; onDone: (msg: string) => void; onNeedDetails: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = row.status === "void" || row.status === "red";
  async function change(next: InvoiceStatus) {
    if ((next === "issued" || next === "sent" || next === "void" || next === "red") && !row.invoiceNo) return onNeedDetails();
    if (next === "sent" && !row.sentTo) return onNeedDetails();
    setBusy(true);
    setError("");
    try {
      await api.call("invoices.update", { id: row.id, revision: row.revision, status: next });
      onDone(`已改为${INVOICE_STATUS_LABEL[next]}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inv-quick">
      <select
        aria-label="改状态"
        className={`inv-status-select s-${row.status}`}
        value={row.status}
        disabled={busy || locked}
        onChange={(e) => void change(e.target.value as InvoiceStatus)}
      >
        {INVOICE_STATUSES.map((s) => (
          <option key={s} value={s}>{s === "void" ? "作废" : s === "red" ? "红冲" : INVOICE_STATUS_LABEL[s]}</option>
        ))}
      </select>
      {error && <small className="inv-error">{error}</small>}
    </span>
  );
}

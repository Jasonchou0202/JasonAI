import { useState } from "react";
import { BellPlus, Check } from "lucide-react";
import type { Api } from "../domain/model";
import type { Expense } from "../domain/expenses";
import { renewLabel, renewName, renewRemindDate, renewTitle, RENEW_NAME_MAX, type ExpenseRenew } from "../domain/renew";
import { dateLabel } from "../domain/dates";
import { message, Modal } from "./ui";

/** 报销明细每条记录上的「续费提醒」：点 → 轻量确认 → 建日程；建过的显示「已设提醒 · 12月9日」 */
export function RenewButton({
  api,
  row,
  renew,
  admin,
  onDone,
}: {
  api: Api;
  row: Expense;
  renew?: ExpenseRenew;
  admin: boolean;
  onDone: (renew: ExpenseRenew) => void;
}) {
  const [open, setOpen] = useState(false);
  if (renew)
    return (
      <span className="exp-renew done" title={`已设「${renew.title}」提醒：${renewLabel(renew.date)}`}>
        <Check size={14} aria-hidden />
        已设提醒 · {dateLabel(renew.date)}
      </span>
    );
  if (row.status === "rejected") return null;
  return (
    <>
      <button type="button" className="exp-renew" onClick={() => setOpen(true)}>
        <BellPlus size={14} aria-hidden />
        续费提醒
      </button>
      {open && <RenewConfirm api={api} row={row} admin={admin} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function RenewConfirm({
  api,
  row,
  admin,
  onClose,
  onDone,
}: {
  api: Api;
  row: Expense;
  admin: boolean;
  onClose: () => void;
  onDone: (renew: ExpenseRenew) => void;
}) {
  const [name, setName] = useState(row.categoryName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const when = renewLabel(renewRemindDate(row.date));
  const shown = renewName(name, row.categoryName);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.call<{ renew: ExpenseRenew }>("expenses.renew", { id: row.id, name: shown });
      onDone(r.renew);
      onClose();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="设续费提醒" onClose={busy ? () => undefined : onClose}>
      <div className="exp-renew-confirm">
        <p className="exp-renew-line">
          将在 <b>{when}</b> 提醒 <b>{renewTitle(shown)}</b>
        </p>
        <label htmlFor={`renew-name-${row.id}`}>续费项目</label>
        <input
          id={`renew-name-${row.id}`}
          value={name}
          maxLength={RENEW_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：ToDesk"
          disabled={busy}
        />
        <p className="exp-renew-hint">
          记账日是扣费日，提醒在下次扣费前一天（北京时间）。日程归你，{admin ? "同步到 iPhone 和 Notion" : "不同步到 Jason 的 iPhone"}。每条报销只能设一次。
        </p>
        {error && <p className="exp-renew-error" role="alert">{error}</p>}
        <div className="exp-renew-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="button primary" onClick={submit} disabled={busy || !shown}>
            {busy ? "正在设置…" : "设提醒"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

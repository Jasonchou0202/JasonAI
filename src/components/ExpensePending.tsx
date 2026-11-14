import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Api } from "../domain/model";
import type { Expense } from "../domain/expenses";
import { EXPENSE_STATUS_LABEL } from "../domain/expenses";
import { money } from "../domain/finance";
import { ErrorNote, message, useQuery } from "./ui";
import "../expenses.css";

function zhDate(date: string) {
  return `${date.slice(0, 4)} / ${date.slice(5, 7)} / ${date.slice(8)}`;
}

export function ExpensePending({
  api,
  version,
  onBack,
  onChanged,
}: {
  api: Api;
  version: number;
  onBack: () => void;
  onChanged: (text: string) => void;
}) {
  const { data, error, loading } = useQuery<{
    items: Expense[];
    people: { owner: { uid: string; name: string }; partner: { uid: string; name: string } };
  }>(api, "expenses.list", { status: "pending_confirm" }, version);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const people = data?.people;
  function nameOf(uid: string) {
    if (!people) return uid;
    if (uid === people.owner.uid) return people.owner.name;
    if (uid === people.partner.uid) return people.partner.name;
    return people.partner.name;
  }
  async function act(row: Expense, kind: "confirm" | "reject") {
    if (busy) return;
    setErr("");
    setBusy(row.id + kind);
    try {
      await api.call(kind === "confirm" ? "expenses.confirm" : "expenses.reject", {
        id: row.id,
        requestId: crypto.randomUUID(),
        revision: row.revision,
      });
      onChanged(kind === "confirm" ? "已确认入账" : "已驳回");
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy("");
    }
  }
  const items = data?.items || [];
  return (
    <div className="exp-pending-page">
      <div className="page-heading">
        <div>
          <button className="back-link" type="button" onClick={onBack}>
            <ArrowLeft size={15} />
            返回报销记账
          </button>
          <h1>
            待你确认
            {items.length > 0 && <span className="exp-pending-tag" style={{ marginLeft: 10 }}>{items.length} 笔</span>}
          </h1>
          <p className="subtle">其他成员记的账，要你在手机上点头才进账本；你自己记的直接入账。{items.length ? `这 ${items.length} 笔尚未计入合账。` : ""}</p>
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {loading && !data && <p className="subtle">正在打开…</p>}
      {!loading && items.length === 0 && <p className="subtle">暂时没有待确认的报销。</p>}
      <div className="exp-pending-list">
        {items.map((row) => (
          <article className="exp-pending-card" key={row.id}>
            <header>
              <span className="exp-status pending_confirm">{EXPENSE_STATUS_LABEL[row.status]}</span>
              <time dateTime={row.date}>{zhDate(row.date)}</time>
            </header>
            <h2>
              {row.categoryName}
              <b>¥{money(row.amount)}</b>
            </h2>
            <p className="exp-pending-meta">
              {nameOf(row.paidBy)} · {row.hasInvoice ? "有发票" : "无发票"}
            </p>
            {row.note && (
              <p className="exp-pending-note">
                <b>备注</b>
                {row.note}
              </p>
            )}
            <div className="exp-pending-actions">
              <button type="button" className="ghost" disabled={!!busy} onClick={() => void act(row, "reject")}>
                驳回
              </button>
              <button type="button" className="ok" disabled={!!busy} onClick={() => void act(row, "confirm")}>
                确认入账
              </button>
            </div>
          </article>
        ))}
      </div>
      {items.length > 0 && (
        <p className="exp-foot-note">确认后才会记入对应十天段的报销成本，并参与六四分账。</p>
      )}
    </div>
  );
}

import { useState } from "react";
import type { Api } from "../domain/model";
import type { ExpenseCategory, ExpenseMeta } from "../domain/expenses";
import { useTeam } from "../lib/team-ui";
import { ErrorNote, message, useQuery } from "./ui";
import "../expenses.css";

export function ExpenseCategorySettings({
  api,
  version,
  onChange,
}: {
  api: Api;
  version: number;
  onChange: (text: string) => void;
}) {
  const { me } = useTeam();
  const { data, error, loading } = useQuery<ExpenseMeta>(api, "expenses.meta", {}, version);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!me.expensesEnabled || me.role !== "admin") return null;
  async function add() {
    const n = name.trim();
    if (!n || busy) return;
    setErr("");
    setBusy(true);
    try {
      await api.call<ExpenseCategory>("expenses.categories.create", { name: n, requestId: crypto.randomUUID() });
      setName("");
      onChange("已添加报销分类");
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function archive(id: string, label: string) {
    if (busy) return;
    if (!confirm(`不再在新记录里显示「${label}」？已有报销会保留这个分类。`)) return;
    setErr("");
    setBusy(true);
    try {
      await api.call("expenses.categories.archive", { id });
      onChange("已删除分类");
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <div>
          <h2>报销分类</h2>
          <p>记报销时可选用。删除后不再出现在新记录里，已入账的记录会保留原分类。</p>
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {loading && !data && <p className="subtle">正在读取分类…</p>}
      <div className="exp-chips" style={{ marginBottom: 14 }}>
        {data?.categories.map((c) => (
          <span key={c.id} className="exp-status" style={{ height: 32, padding: "0 8px 0 12px", gap: 8 }}>
            {c.name}
            <button type="button" className="icon-button" aria-label={`删除${c.name}`} onClick={() => void archive(c.id, c.name)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="exp-add-cat">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="新分类名称，例如：招待" maxLength={40} />
        <button type="button" className="button secondary" disabled={busy || !name.trim()} onClick={() => void add()}>
          添加分类
        </button>
      </div>
    </section>
  );
}

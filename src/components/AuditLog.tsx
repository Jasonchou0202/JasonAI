import { useState } from "react";
import type { Api } from "../domain/model";
import { ErrorNote, Loading, useQuery } from "./ui";
import "../team.css";

interface Row {
  id: string;
  atBj: string;
  actorUid: string;
  actorName: string;
  role: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  result: "ok" | "denied" | "failed";
  reason?: string;
}
const TYPES: [string, string][] = [
  ["", "全部操作"],
  ["sales", "销售记录"],
  ["tasks", "日程待办"],
  ["customers", "客户"],
  ["products", "商品"],
  ["members", "成员与邀请"],
  ["catalog", "清理/恢复"],
  ["import.commit", "导入"],
  ["backup", "备份/恢复"],
  ["export", "导出"],
  ["push", "推送"],
];
const RESULT = { ok: "成功", denied: "被拒", failed: "失败" } as const;
const ROLE: Record<string, string> = { admin: "管理员", member: "成员", system: "系统", none: "未入队" };
function brief(v?: Record<string, unknown> | null) {
  if (!v) return "";
  return Object.entries(v)
    .map(([k, x]) => `${k}: ${Array.isArray(x) ? x.length + " 项" : typeof x === "object" ? JSON.stringify(x) : String(x)}`)
    .join("，");
}

/** 有改前改后时只列变化的字段 */
function diff(before?: Record<string, unknown> | null, after?: Record<string, unknown> | null) {
  if (!before || !after) return brief(after || before);
  const show = (x: unknown) => (x === null || x === undefined ? "空" : typeof x === "object" ? JSON.stringify(x) : String(x));
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
  return keys.length ? keys.map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`).join("，") : "无变化";
}
/** 操作日志：管理员看全部（#/audit）；成员只看自己的（#/my-log，云端强制按本人过滤） */
export function AuditLog({ api, mode }: { api: Api; mode: "admin" | "self" }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const query = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(action ? { action } : {}),
    ...(mode === "admin" && actor ? { actor } : {}),
    ...(cursor ? { cursor } : {}),
    limit: 50,
  };
  const { data, error, loading } = useQuery<{ rows: Row[]; next: string | null }>(api, "audit.list", query);
  const reset = (f: () => void) => {
    f();
    setCursors([]);
  };
  const people = [...new Map((data?.rows || []).map((r) => [r.actorUid, r.actorName || r.actorUid])).entries()];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">只追加 · 不能修改或删除</p>
          <h1>{mode === "admin" ? "操作日志" : "我的操作记录"}</h1>
          <p className="subtle">
            {mode === "admin" ? "所有人的写操作和被拒的越权尝试，时间均为北京时间。" : "只显示你自己的操作，时间为北京时间。"}
          </p>
        </div>
      </div>
      <section className="panel team-panel">
        <div className="filters">
          <label>
            从
            <input aria-label="日志起始日期" type="date" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
          </label>
          <label>
            至
            <input aria-label="日志结束日期" type="date" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
          </label>
          <select aria-label="操作类型" value={action} onChange={(e) => reset(() => setAction(e.target.value))}>
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {mode === "admin" && (
            <select aria-label="操作人" value={actor} onChange={(e) => reset(() => setActor(e.target.value))}>
              <option value="">全部人</option>
              {people.map(([uid, name]) => (
                <option key={uid} value={uid}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
        {loading && <Loading />}
        {error && <ErrorNote>{error}</ErrorNote>}
        {data && !data.rows.length && <p className="subtle">没有符合条件的记录。</p>}
        {data && data.rows.length > 0 && (
          <div className="team-scroll">
            <table className="team-table" aria-label="操作日志">
              <thead>
                <tr>
                  <th>时间</th>
                  {mode === "admin" && <th>操作人</th>}
                  <th>操作</th>
                  <th>目标</th>
                  <th>改前 → 改后</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="team-time">{r.atBj}</td>
                    {mode === "admin" && (
                      <td>
                        {r.actorName || r.actorUid}
                        <small> {ROLE[r.role] || r.role}</small>
                      </td>
                    )}
                    <td>{r.action}</td>
                    <td title={r.targetId}>
                      {[r.targetType, r.targetId && r.targetId.length > 16 ? r.targetId.slice(0, 14) + "…" : r.targetId]
                        .filter(Boolean)
                        .join(" / ")}
                    </td>
                    <td className="team-diff">{diff(r.before, r.after)}</td>
                    <td>
                      <span className={`team-status ${r.result}`}>{RESULT[r.result]}</span>
                      {r.reason && <small> {r.reason}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="team-row">
          <button className="button secondary" disabled={!cursors.length} onClick={() => setCursors((c) => c.slice(0, -1))}>
            上一页
          </button>
          <button className="button secondary" disabled={!data?.next} onClick={() => data?.next && setCursors((c) => [...c, data.next!])}>
            下一页
          </button>
        </div>
      </section>
    </>
  );
}

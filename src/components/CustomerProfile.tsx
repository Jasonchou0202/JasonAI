import { useState } from "react";
import { Plus, Save, UserRound } from "lucide-react";
import type { Api, Sale } from "../domain/model";
import { today } from "../domain/dates";
import { QUADRANTS, QUADRANT_INFO, tierOf } from "../domain/insights";
import {
  NEED_PRESETS, OCCUPATION_PRESETS, PAYMENT_METHODS, PURCHASE_STATUS_RULE,
  mergeOptions, purchaseStatus, type CustomerProfile,
} from "../domain/profile";
import { apiMode, readLocal, writeLocal, useCustomerMutation, type Customer } from "../lib/customer-ui";
import { useInsights } from "../lib/insights-ui";
import { ErrorNote } from "./ui";

interface LocalOptions { occupations: string[]; needs: string[] }
const optionsKey = (mode: string) => `zhangyuge-profile-options-${mode}-v1`;
/** 选项 = 预设 + 所有客户已用过的值 + 本机新增；自定义选项只保存在你自己的账本和本机，不写进公开代码 */
export function useProfileOptions(mode: string) {
  const { customers } = useInsights();
  const [local, setLocal] = useState<LocalOptions>(() => ({ occupations: [], needs: [], ...readLocal<LocalOptions>(optionsKey(mode)) }));
  const used = customers.map((c) => c.profile).filter(Boolean) as CustomerProfile[];
  function add(kind: keyof LocalOptions, value: string) {
    const next = { ...local, [kind]: mergeOptions([], local[kind], [value]) };
    setLocal(next);
    writeLocal(optionsKey(mode), next);
  }
  return {
    occupations: mergeOptions(OCCUPATION_PRESETS, used.map((p) => p.occupation ?? ""), local.occupations),
    needs: mergeOptions(NEED_PRESETS, used.flatMap((p) => p.needs ?? []), local.needs),
    add,
  };
}

/** 客户名下方的一行标签：等级 · 矩阵色块 · 复购/断购 · 职业 · 付款方式 */
export function CustomerChips({ customer, sales }: { customer: Customer; sales: Sale[] }) {
  const { insights } = useInsights();
  const profit = insights?.customerProfit.get(customer.id);
  const quads = insights?.customerQuadrants.get(customer.id);
  const status = purchaseStatus(sales.filter((s) => !s.deletedAt).map((s) => s.date), today());
  const p = customer.profile;
  return (
    <div className="profile-chips" aria-label="客户标签">
      {profit !== undefined && (() => { const t = tierOf(profit); return <span className={`p-chip tier-chip-solid tier-${t}`} title={`按累计纯利划分为 ${t}`}>{t}</span>; })()}
      {QUADRANTS.filter((q) => quads?.has(q)).map((q) => (
        <span key={q} className="p-chip" style={{ background: QUADRANT_INFO[q].color, color: "#fff" }} title={QUADRANT_INFO[q].label}>{QUADRANT_INFO[q].label.replace(/ × /, "")}</span>
      ))}
      {status === "repeat" && <span className="p-chip status-repeat" title={PURCHASE_STATUS_RULE.repeat}>复购客户</span>}
      {status === "lapsed" && <span className="p-chip status-lapsed" title={PURCHASE_STATUS_RULE.lapsed}>断购客户</span>}
      {p?.occupation && <span className="p-chip neutral">{p.occupation}</span>}
      {p?.payment && <span className="p-chip neutral">偏好{p.payment}</span>}
    </div>
  );
}

/** 客户画像编辑：职业、需求（多选 + 文字）、偏好付款方式 */
export function CustomerProfileEditor({ api, customer, onSaved }: { api: Api; customer: Customer; onSaved: (msg: string) => void }) {
  const mode = apiMode(api);
  const options = useProfileOptions(mode);
  const mutation = useCustomerMutation(api, mode, `profile-${customer.id}`);
  const [form, setForm] = useState<CustomerProfile>(() => ({ needs: [], ...customer.profile }));
  const [newNeed, setNewNeed] = useState("");
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<CustomerProfile>) => setForm((f) => ({ ...f, ...patch }));
  const needs = form.needs ?? [];
  async function save() {
    const profile: CustomerProfile = {
      ...(form.occupation?.trim() ? { occupation: form.occupation.trim() } : {}),
      needs,
      ...(form.needNote?.trim() ? { needNote: form.needNote } : {}),
      ...(form.payment ? { payment: form.payment } : {}),
    };
    if (profile.occupation && !options.occupations.includes(profile.occupation)) options.add("occupations", profile.occupation);
    if (await mutation.run("customers.profile.save", { id: customer.id, revision: customer.revision, profile })) {
      setOpen(false);
      onSaved("客户画像已保存");
    }
  }
  const err = /不支持的操作/.test(mutation.error)
    ? "云端账本还没有更新到支持客户画像的版本，暂时无法保存；部署更新后即可使用。"
    : mutation.error;
  return (
    <section className="panel profile-editor">
      <div className="panel-heading">
        <div>
          <h2><UserRound size={17} /> 客户画像</h2>
          <p>职业、需求和付款习惯，方便跟进时对症下药</p>
        </div>
        {!open && <button className="button secondary" onClick={() => setOpen(true)}>编辑画像</button>}
      </div>
      {!open ? (
        <dl className="profile-view">
          <div><dt>职业</dt><dd>{customer.profile?.occupation || "未填写"}</dd></div>
          <div><dt>客户需求</dt><dd>{customer.profile?.needs?.join("、") || "未填写"}</dd></div>
          {customer.profile?.needNote && <div><dt>需求记录</dt><dd className="pre">{customer.profile.needNote}</dd></div>}
          <div><dt>偏好付款方式</dt><dd>{customer.profile?.payment || "未填写"}</dd></div>
        </dl>
      ) : (
        <form className="profile-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label htmlFor="pf-occ">职业标签</label>
          <div>
            <input id="pf-occ" list="pf-occ-list" maxLength={40} value={form.occupation ?? ""} placeholder="选择或输入职业" onChange={(e) => set({ occupation: e.target.value })} />
            <datalist id="pf-occ-list">{options.occupations.map((o) => <option key={o} value={o} />)}</datalist>
            <div className="pf-options" role="group" aria-label="常用职业">
              {options.occupations.map((o) => (
                <button type="button" key={o} className={`pf-opt ${form.occupation === o ? "on" : ""}`} aria-pressed={form.occupation === o} onClick={() => set({ occupation: form.occupation === o ? "" : o })}>{o}</button>
              ))}
            </div>
            <small className="muted">输入列表里没有的职业，保存后会自动加入选项</small>
          </div>
          <span className="pf-label">客户需求</span>
          <div>
            <div className="pf-checks" role="group" aria-label="客户需求">
              {options.needs.map((n) => (
                <label key={n} className={`pf-check ${needs.includes(n) ? "on" : ""}`}>
                  <input type="checkbox" checked={needs.includes(n)} onChange={(e) => set({ needs: e.target.checked ? [...needs, n] : needs.filter((x) => x !== n) })} />
                  {n}
                </label>
              ))}
            </div>
            <div className="pf-add">
              <input aria-label="新增需求选项" maxLength={40} value={newNeed} placeholder="新增需求选项" onChange={(e) => setNewNeed(e.target.value)} />
              <button type="button" className="button secondary" disabled={!newNeed.trim()} onClick={() => { options.add("needs", newNeed); set({ needs: [...new Set([...needs, newNeed.trim()])] }); setNewNeed(""); }}><Plus size={14} /> 添加</button>
            </div>
            <textarea aria-label="需求记录" rows={3} maxLength={2000} value={form.needNote ?? ""} placeholder="记录客户具体想要什么、预算、时间点…" onChange={(e) => set({ needNote: e.target.value })} />
          </div>
          <label htmlFor="pf-pay">偏好付款方式</label>
          <select id="pf-pay" value={form.payment ?? ""} onChange={(e) => set({ payment: (e.target.value || undefined) as CustomerProfile["payment"] })}>
            <option value="">未选择</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {err && <ErrorNote>{err}</ErrorNote>}
          <div className="customer-actions">
            <button type="button" className="button secondary" onClick={() => { setOpen(false); setForm({ needs: [], ...customer.profile }); }}>取消</button>
            <button type="submit" className="button primary" disabled={mutation.busy}><Save size={16} />{mutation.busy ? "保存中…" : "保存画像"}</button>
          </div>
        </form>
      )}
    </section>
  );
}

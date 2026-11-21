import { useState } from "react";
import { Plus, Save, UserRound } from "lucide-react";
import type { Api, Sale } from "../domain/model";
import { today } from "../domain/dates";
import {
  CLAUDE_COMPUTERS, CLAUDE_NEED, CLAUDE_TYPES, CLAUDE_USAGES, NEED_PRESETS, OCCUPATION_PRESETS, PAYMENT_METHODS, PURCHASE_STATUS_RULE,
  blankClaudeAccount, claudeAccountSummary, mergeOptions, purchaseStatus,
  type ClaudeAccount, type CustomerProfile,
} from "../domain/profile";
import { apiMode, readLocal, writeLocal, useCustomerMutation, type Customer } from "../lib/customer-ui";
import { QuadrantBlocks, TierBadge, useInsights } from "../lib/insights-ui";
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
      {profit !== undefined && <TierBadge profit={profit} />}
      {insights && <span className="p-blocks"><QuadrantBlocks has={quads} /></span>}
      {status === "repeat" && <span className="p-chip status-repeat" title={PURCHASE_STATUS_RULE.repeat}>复购客户</span>}
      {status === "new" && <span className="p-chip status-new" title={PURCHASE_STATUS_RULE.new}>新客</span>}
      {status === "lapsed" && <span className="p-chip status-lapsed" title={PURCHASE_STATUS_RULE.lapsed}>断购客户</span>}
      {p?.occupation && <span className="p-chip neutral">{p.occupation}</span>}
      {p?.payment && <span className="p-chip neutral">{p.payment}</span>}
    </div>
  );
}

type DraftAccount = Partial<Pick<ClaudeAccount, "type" | "usage" | "computer">> & { email: string; hubStudioPhone: string };
type ProfileForm = Omit<CustomerProfile, "claudeAccounts"> & { claudeAccounts: DraftAccount[] };
const emptyAccount = (): DraftAccount => ({ email: "", hubStudioPhone: "" });
function draftsFrom(profile?: CustomerProfile): DraftAccount[] {
  const rows = profile?.claudeAccounts?.map((a) => ({ type: a.type, usage: a.usage, computer: a.computer, email: a.email, hubStudioPhone: a.hubStudioPhone ?? "" }));
  return rows?.length ? rows : [emptyAccount()];
}

/** 客户画像编辑：职业、需求（多选 + 文字）、Claude 账号、偏好付款方式 */
export function CustomerProfileEditor({ api, customer, onSaved }: { api: Api; customer: Customer; onSaved: (msg: string) => void }) {
  const mode = apiMode(api);
  const options = useProfileOptions(mode);
  const mutation = useCustomerMutation(api, mode, `profile-${customer.id}`);
  const [form, setForm] = useState<ProfileForm>(() => ({
    needs: [],
    ...customer.profile,
    claudeAccounts: draftsFrom(customer.profile),
  }));
  const [newNeed, setNewNeed] = useState("");
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<ProfileForm>) => setForm((f) => ({ ...f, ...patch }));
  const needs = form.needs ?? [];
  const showClaude = needs.includes(CLAUDE_NEED);
  const accounts = form.claudeAccounts?.length ? form.claudeAccounts : [emptyAccount()];
  const patchAccount = (i: number, patch: Partial<DraftAccount>) =>
    set({ claudeAccounts: accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  function toggleNeed(n: string, on: boolean) {
    const next = on ? [...needs, n] : needs.filter((x) => x !== n);
    set({ needs: next, claudeAccounts: next.includes(CLAUDE_NEED) && !form.claudeAccounts?.length ? [emptyAccount()] : form.claudeAccounts });
  }
  async function save() {
    const profile: CustomerProfile = {
      ...(form.occupation?.trim() ? { occupation: form.occupation.trim() } : {}),
      needs,
      ...(form.needNote?.trim() ? { needNote: form.needNote } : {}),
      ...(form.payment ? { payment: form.payment } : {}),
    };
    if (needs.includes(CLAUDE_NEED)) {
      const filled = accounts.filter((a) => !blankClaudeAccount(a));
      if (filled.length) profile.claudeAccounts = filled as ClaudeAccount[];
    }
    if (profile.occupation && !options.occupations.includes(profile.occupation)) options.add("occupations", profile.occupation);
    if (await mutation.run("customers.profile.save", { id: customer.id, revision: customer.revision, profile })) {
      setOpen(false);
      onSaved("客户信息和需求已保存");
    }
  }
  const err = /不支持的操作/.test(mutation.error)
    ? "云端账本还没有更新到支持「客户信息和需求收集」的版本，暂时无法保存；部署更新后即可使用。"
    : mutation.error;
  const savedAccounts = customer.profile?.needs?.includes(CLAUDE_NEED) ? customer.profile.claudeAccounts ?? [] : [];
  const demo = mode === "demo";
  return (
    <section className="panel profile-editor">
      {demo && (
        <div className="profile-demo-mark" aria-hidden="true">
          <span className="profile-demo-tag">示意图／示例数据</span>
          <span>邮箱与手机号为示例，非正式数据</span>
        </div>
      )}
      <div className="panel-heading">
        <div>
          <h2><UserRound size={17} /> 客户信息和需求收集</h2>
          <p>职业、需求和付款习惯，方便跟进时对症下药</p>
        </div>
        {!open && <button className="button secondary" onClick={() => setOpen(true)}>编辑客户信息和需求</button>}
      </div>
      {!open ? (
        <dl className={`profile-view${savedAccounts.length ? " has-claude" : ""}`}>
          <div><dt>职业</dt><dd>{customer.profile?.occupation || "未填写"}</dd></div>
          <div className="need-cell">
            <dt>客户需求</dt>
            <dd>
              <div className="need-name">{customer.profile?.needs?.join("、") || "未填写"}</div>
              {savedAccounts.length > 0 && (
                <div className="claude-view">
                  <div className="claude-view-title">Claude 账号</div>
                  <ol>{savedAccounts.map((a, i) => <li key={i}>{claudeAccountSummary(a, i)}</li>)}</ol>
                </div>
              )}
            </dd>
          </div>
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
                  <input type="checkbox" checked={needs.includes(n)} onChange={(e) => toggleNeed(n, e.target.checked)} />
                  {n}
                </label>
              ))}
            </div>
            {showClaude && (
              <div className="claude-box">
                <div className="claude-box-head"><div className="claude-box-title">Claude 账号</div></div>
                {accounts.map((a, i) => (
                  <div className="acct" key={i}>
                    <div className="acct-top">
                      <span className="acct-no">{"①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"[i] ?? `${i + 1}.`} 账号</span>
                      {accounts.length > 1 && <button type="button" className="acct-del" onClick={() => set({ claudeAccounts: accounts.filter((_, j) => j !== i) })}>删除</button>}
                    </div>
                    <div className="acct-grid">
                      <div className="acct-field">
                        <span>账号类型</span>
                        <div className="segmented" role="group" aria-label={`第 ${i + 1} 个账号类型`}>
                          {CLAUDE_TYPES.map((t) => (
                            <button type="button" key={t} className={a.type === t ? "active" : ""} aria-pressed={a.type === t} onClick={() => patchAccount(i, { type: t })}>{t}</button>
                          ))}
                        </div>
                      </div>
                      <div className="acct-field">
                        <span>使用方式</span>
                        <div className="segmented" role="group" aria-label={`第 ${i + 1} 个使用方式`}>
                          {CLAUDE_USAGES.map((t) => (
                            <button type="button" key={t} className={a.usage === t ? "active" : ""} aria-pressed={a.usage === t} onClick={() => patchAccount(i, { usage: t })}>{t}</button>
                          ))}
                        </div>
                      </div>
                      <div className="acct-field os">
                        <span>Claude 配置电脑类型</span>
                        <div className="segmented" role="group" aria-label={`第 ${i + 1} 个电脑类型`}>
                          {CLAUDE_COMPUTERS.map((t) => (
                            <button type="button" key={t} className={a.computer === t ? "active" : ""} aria-pressed={a.computer === t} onClick={() => patchAccount(i, { computer: t })}>{t}</button>
                          ))}
                        </div>
                      </div>
                      <div className="acct-field">
                        <span>Claude 注册邮箱</span>
                        <input inputMode="email" autoComplete="off" maxLength={120} value={a.email} placeholder="example01@mail.com" onChange={(e) => patchAccount(i, { email: e.target.value })} aria-label={`第 ${i + 1} 个 Claude 注册邮箱`} />
                      </div>
                      {a.usage === "网页端" && (
                        <div className="acct-field">
                          <span>HubStudio 注册手机号</span>
                          <input inputMode="tel" autoComplete="off" maxLength={24} value={a.hubStudioPhone} placeholder="仅网页端需填写" onChange={(e) => patchAccount(i, { hubStudioPhone: e.target.value })} aria-label={`第 ${i + 1} 个 HubStudio 注册手机号`} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div className="btn-add-row">
                  <button type="button" className="btn-add-acct" onClick={() => set({ claudeAccounts: [...accounts, emptyAccount()] })}><Plus size={14} /> 添加账号</button>
                  <span className="btn-add-hint">需要多个账号时点此展开下一条</span>
                </div>
                <p className="claude-hint">仅记手机号与邮箱，不存密码；选网页端才需填 HubStudio 手机号；对所有客户生效</p>
              </div>
            )}
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
            <button type="button" className="button secondary" onClick={() => { setOpen(false); setForm({ needs: [], ...customer.profile, claudeAccounts: draftsFrom(customer.profile) }); }}>取消</button>
            <button type="submit" className="button primary" disabled={mutation.busy}><Save size={16} />{mutation.busy ? "保存中…" : "保存客户信息和需求"}</button>
          </div>
        </form>
      )}
    </section>
  );
}

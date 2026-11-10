import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Check, Pencil, Plus, RotateCcw, Trash2, Sparkles } from "lucide-react";
import { QUADRANTS, QUADRANT_INFO, type Quadrant } from "../domain/insights";
import { PRESET_ACTIONS, type EffectiveAction } from "../domain/actions";
import { useActionLibrary } from "../lib/insights-ui";

/** 日程管理里的「有效动作库」：按客户 × 产品矩阵分组，可增改删，可一键加入日程 */
export function ActionLibrary({ mode, focus, onSchedule }: { mode: string; focus?: Quadrant; onSchedule: (a: EffectiveAction) => void }) {
  const { actions, save } = useActionLibrary(mode);
  const [adding, setAdding] = useState<Quadrant | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus) ref.current?.querySelector(`[data-quadrant="${focus}"]`)?.scrollIntoView({ block: "center" });
  }, [focus]);
  function reset() { setAdding(null); setEditing(null); setText(""); }
  function commit(q: Quadrant) {
    const v = text.trim().slice(0, 200);
    if (!v) return;
    if (editing) save(actions.map((a) => (a.id === editing ? { ...a, text: v } : a)));
    else save([...actions, { id: "custom-" + Date.now().toString(36), quadrant: q, text: v }]);
    reset();
  }
  return (
    <section className="panel action-library" ref={ref} aria-labelledby="action-lib-title">
      <div className="panel-heading">
        <div>
          <h2 id="action-lib-title"><Sparkles size={17} /> 有效动作库</h2>
          <p>按客户 × 产品矩阵整理的打法，新增日程时可直接引用；保存在本机浏览器</p>
        </div>
        <button className="text-button" onClick={() => confirm("恢复为预设动作？自定义的动作会被清除。") && save(PRESET_ACTIONS.map((a) => ({ ...a })))}>
          <RotateCcw size={14} /> 恢复预设
        </button>
      </div>
      <div className="action-groups">
        {QUADRANTS.map((q) => {
          const info = QUADRANT_INFO[q];
          const list = actions.filter((a) => a.quadrant === q);
          const form = adding === q || Boolean(editing && list.some((a) => a.id === editing));
          return (
            <div key={q} className={`action-group ${focus === q ? "focused" : ""}`} data-quadrant={q} style={{ ["--q" as string]: info.color }}>
              <h3><i style={{ background: info.color }} />{info.label}</h3>
              <ul>
                {list.map((a) => (
                  <li key={a.id}>
                    <span>{a.text}</span>
                    <span className="action-tools">
                      <button className="icon-button" aria-label={`把「${a.text}」加入日程`} title="加入日程" onClick={() => onSchedule(a)}><CalendarPlus size={15} /></button>
                      <button className="icon-button" aria-label={`编辑「${a.text}」`} title="编辑" onClick={() => { setEditing(a.id); setAdding(null); setText(a.text); }}><Pencil size={14} /></button>
                      <button className="icon-button" aria-label={`删除「${a.text}」`} title="删除" onClick={() => save(actions.filter((x) => x.id !== a.id))}><Trash2 size={14} /></button>
                    </span>
                  </li>
                ))}
                {!list.length && <li className="muted">还没有动作，添加一条吧</li>}
              </ul>
              {form ? (
                <form className="action-add" onSubmit={(e) => { e.preventDefault(); commit(q); }}>
                  <input autoFocus maxLength={200} value={text} aria-label={`${info.label}动作内容`} placeholder="写下一条有效动作" onChange={(e) => setText(e.target.value)} />
                  <button className="button primary" type="submit">保存</button>
                  <button className="button secondary" type="button" onClick={reset}>取消</button>
                </form>
              ) : (
                <button className="text-button" onClick={() => { setAdding(q); setEditing(null); setText(""); }}><Plus size={14} /> 添加动作</button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * 日程表单里的「有效动作」多选：客户落在哪些色块，就只列这些色块的动作（方案 A，动作库仍只存本机）。
 * quadrants 为 undefined 表示还没选客户；空集合表示这位客户还没有成交。
 */
export function ActionPicker({
  mode,
  quadrants,
  selected,
  onToggle,
}: {
  mode: string;
  quadrants?: ReadonlySet<Quadrant>;
  selected: ReadonlySet<string>;
  onToggle: (a: EffectiveAction, on: boolean) => void;
}) {
  const { actions } = useActionLibrary(mode);
  const groups = QUADRANTS.filter((q) => quadrants?.has(q));
  return (
    <div className="action-picker" role="group" aria-label="有效动作（按客户色块，可多选）">
      <div className="action-picker-head">
        <span>有效动作</span>
        <small>按这位客户所在色块显示，可多选</small>
      </div>
      {!quadrants ? (
        <p className="action-picker-hint">先选择客户，再按客户所在色块挑动作。</p>
      ) : !groups.length ? (
        <p className="action-picker-hint">这位客户还没有成交记录，暂时没有对应色块的动作。</p>
      ) : (
        groups.map((q) => {
          const list = actions.filter((a) => a.quadrant === q);
          return (
            <div key={q} className="action-picker-group" data-quadrant={q} style={{ ["--q" as string]: QUADRANT_INFO[q].color }}>
              <span className="quad-capsule">{QUADRANT_INFO[q].short}</span>
              <div>
                {list.length ? list.map((a) => {
                  const on = selected.has(a.id);
                  return (
                    <button type="button" key={a.id} className={`action-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onToggle(a, !on)}>
                      {on && <Check size={13} aria-hidden="true" />}
                      {a.text}
                    </button>
                  );
                }) : <small className="muted">这个色块还没有动作，可在下方「有效动作库」添加</small>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

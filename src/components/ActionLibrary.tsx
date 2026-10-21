import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Pencil, Plus, RotateCcw, Trash2, Sparkles } from "lucide-react";
import { QUADRANTS, QUADRANT_INFO, type Quadrant } from "../domain/insights";
import { PRESET_ACTIONS, type EffectiveAction } from "../domain/actions";
import { useActionLibrary } from "../lib/insights-ui";

/** 日程管理里的「有效动作库」：按四象限分组，可增改删，可一键加入日程 */
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
          <p>按四象限整理的打法，新增日程时可直接引用；保存在本机浏览器</p>
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

/** 日程表单里的「引用有效动作」选择器 */
export function ActionPicker({ mode, onPick }: { mode: string; onPick: (a: EffectiveAction) => void }) {
  const { actions } = useActionLibrary(mode);
  return (
    <details className="action-picker">
      <summary>引用有效动作</summary>
      {QUADRANTS.map((q) => {
        const list = actions.filter((a) => a.quadrant === q);
        if (!list.length) return null;
        return (
          <div key={q} className="action-picker-group">
            <small><i style={{ background: QUADRANT_INFO[q].color }} />{QUADRANT_INFO[q].label}</small>
            <div>
              {list.map((a) => (
                <button type="button" key={a.id} className="action-chip" style={{ ["--q" as string]: QUADRANT_INFO[q].color }} onClick={() => onPick(a)}>{a.text}</button>
              ))}
            </div>
          </div>
        );
      })}
    </details>
  );
}

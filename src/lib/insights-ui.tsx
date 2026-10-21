import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Api, Customer, Sale } from "../domain/model";
import { buildInsights, QUADRANT_INFO, QUADRANTS, tierOf, type Insights, type Quadrant } from "../domain/insights";
import { parseActions, type EffectiveAction } from "../domain/actions";

interface Ctx { insights?: Insights; sales: Sale[]; customers: Customer[] }
const InsightsContext = createContext<Ctx>({ sales: [], customers: [] });

/** 只读：取全部有效销售和客户档案，在本机算出等级和象限，不写任何数据 */
export function InsightsProvider({ api, version, children }: { api: Api; version: number; children: ReactNode }) {
  const [state, setState] = useState<{ sales: Sale[]; customers: Customer[] }>();
  useEffect(() => {
    let live = true;
    Promise.all([api.call<Sale[]>("export", {}), api.call<Customer[]>("customers.list", {})])
      .then(([sales, customers]) => live && setState({ sales, customers }))
      .catch(() => live && setState(undefined));
    return () => { live = false; };
  }, [api, version]);
  const value = useMemo<Ctx>(() => {
    if (!state) return { sales: [], customers: [] };
    try { return { insights: buildInsights(state.sales, state.customers), sales: state.sales, customers: state.customers }; }
    catch { return { sales: [], customers: [] }; }
  }, [state]);
  return <InsightsContext.Provider value={value}>{children}</InsightsContext.Provider>;
}
export const useInsights = () => useContext(InsightsContext);

export function TierBadge({ profit }: { profit?: number }) {
  if (profit === undefined) return null;
  const t = tierOf(profit);
  return <span className={`tier-badge tier-${t}`} title={`客户等级 ${t}（按累计纯利）`}>{t}</span>;
}

/** 四个小色块：有该象限成交就上色，没有显示灰色（待开拓） */
export function QuadrantBlocks({ has }: { has?: Set<Quadrant> }) {
  return (
    <span className="quad-blocks" role="img" aria-label={"客户 × 产品矩阵：" + QUADRANTS.map((q) => `${QUADRANT_INFO[q].label}${has?.has(q) ? "有成交" : "待开拓"}`).join("，")}>
      {QUADRANTS.map((q) => (
        <i key={q} title={`${QUADRANT_INFO[q].label} · ${has?.has(q) ? "有成交" : "待开拓"}`}
          style={{ background: has?.has(q) ? QUADRANT_INFO[q].color : undefined }} />
      ))}
    </span>
  );
}
export function QuadrantDot({ q }: { q?: Quadrant }) {
  if (!q) return null;
  return <i className="quad-dot" style={{ background: QUADRANT_INFO[q].color }} title={QUADRANT_INFO[q].label} aria-label={QUADRANT_INFO[q].label} />;
}

const actionKey = (mode: string) => `zhangyuge-effective-actions-${mode}-v1`;
export function useActionLibrary(mode: string) {
  const [actions, setActions] = useState<EffectiveAction[]>(() => {
    try { return parseActions(JSON.parse(localStorage.getItem(actionKey(mode)) ?? "null")); }
    catch { return parseActions(null); }
  });
  function save(next: EffectiveAction[]) {
    setActions(next);
    try { localStorage.setItem(actionKey(mode), JSON.stringify(next)); } catch { /* 存不下时仅本次有效 */ }
  }
  return { actions, save };
}

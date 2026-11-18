/**
 * 内容闭环看板 · 小程序只读版（第 3 批，方案对照表 13a）。
 * 小程序不能打开 github.io，所以把仓库里的 content-board-src/data/dashboard.json 随 miniapp 函数一起打包，
 * 这里只挑看板上的摘要字段（不带链接以外的内部备注），回包控制在几十 KB。
 * 数据新旧取决于 miniapp 函数最近一次部署时仓库里的快照；页面上会写明「数据时间」。
 */
import raw from "../../content-board-src/data/dashboard.json";

export const BOARD_WEB_URL = "https://jasonchou0202.github.io/JasonAI/";
type Any = Record<string, any>;
const s = (v: unknown, max = 120) => (typeof v === "string" ? (v.length > max ? v.slice(0, max - 1) + "…" : v) : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface BoardSummary {
  updatedAt: string;
  week: string;
  summary: string;
  kpis: { key: string; title: string; value: number | null; unit: string; note: string; real: boolean }[];
  stages: { id: number; name: string; owner: string; rhythm: string; count: number }[];
  topics: { id: string; date: string; title: string; stage: number; stageName: string; platforms: { name: string; status: string }[] }[];
  decisions: { title: string; why: string; since: string }[];
  risks: { level: string; text: string }[];
  mechanisms: { no: number; title: string; status: string }[];
  webUrl: string;
}

export function boardSummary(d: Any = raw as Any): BoardSummary {
  const stages: Any[] = Array.isArray(d.stages) ? d.stages : [];
  const topics: Any[] = Array.isArray(d.topics) ? d.topics : [];
  const stageName = (id: number) => s(stages.find((x) => x.id === id)?.name, 20);
  return {
    updatedAt: s(d.updated_at, 40),
    week: s(d.week?.label, 60),
    summary: s(d.week_summary?.text, 200),
    kpis: (Array.isArray(d.kpis) ? d.kpis : []).slice(0, 12).map((k: Any) => ({
      key: s(k.key, 40),
      title: s(k.title, 20),
      value: n(k.value),
      unit: s(k.unit, 20),
      note: s(k.note, 90),
      real: k.status === "real",
    })),
    stages: stages.slice(0, 12).map((x) => ({
      id: Number(x.id) || 0,
      name: s(x.name, 20),
      owner: s(x.owner, 40),
      rhythm: s(x.rhythm, 20),
      count: topics.filter((t) => t.stage === x.id).length,
    })),
    topics: [...topics]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 10)
      .map((t) => ({
        id: s(t.id, 80),
        date: s(t.date, 10),
        title: s(t.title, 80),
        stage: Number(t.stage) || 0,
        stageName: stageName(Number(t.stage)),
        platforms: (Array.isArray(t.platforms) ? t.platforms : []).slice(0, 6).map((p: Any) => ({ name: s(p.platform, 10), status: s(p.status, 20) })),
      })),
    decisions: (Array.isArray(d.decisions) ? d.decisions : []).slice(0, 6).map((x: Any) => ({ title: s(x.title, 80), why: s(x.why, 80), since: s(x.since, 10) })),
    risks: (Array.isArray(d.risks) ? d.risks : []).slice(0, 6).map((x: Any) => ({ level: x.level === "red" ? "red" : x.level === "yellow" ? "yellow" : "info", text: s(x.text, 120) })),
    mechanisms: (Array.isArray(d.mechanisms?.items) ? d.mechanisms.items : []).slice(0, 12).map((x: Any) => ({ no: Number(x.no) || 0, title: s(x.title, 60), status: s(x.status, 10) })),
    webUrl: BOARD_WEB_URL,
  };
}

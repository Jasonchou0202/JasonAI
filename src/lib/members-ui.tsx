import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Api } from "../domain/model";
import {
  OWNER_COLOR,
  SYSTEM_COLOR,
  TAG_TEXT,
  UNASSIGNED_COLOR,
  avatarInitial,
  memberColor,
  taskOwner,
  type MemberColor,
} from "../domain/members";
import type { Me } from "./team-me";
import "../members.css";

export interface Person {
  uid: string;
  name: string;
  role: "admin" | "member";
  status: "active" | "disabled";
  color: string | null;
  avatar?: { url: string; hash: string };
}
export interface Directory {
  /** 日程归属开关开着、目录已就绪 */
  on: boolean;
  avatars: boolean;
  ownerUid: string;
  meUid: string;
  people: Person[];
  person: (uid: string | null | undefined) => Person | undefined;
  color: (uid: string | null | undefined) => MemberColor;
  name: (uid: string | null | undefined) => string;
  ownerOf: (task: { ownerUid?: string | null; createdBy?: string | null }) => string;
  refresh: () => void;
}
const OFF: Directory = {
  on: false,
  avatars: false,
  ownerUid: "",
  meUid: "",
  people: [],
  person: () => undefined,
  color: () => UNASSIGNED_COLOR,
  name: () => "",
  ownerOf: () => "",
  refresh: () => undefined,
};
const DirectoryContext = createContext<Directory>(OFF);
export const useDirectory = () => useContext(DirectoryContext);

/** 拉一次 members.directory；开关关时什么都不请求，界面与现在一致 */
export function DirectoryProvider({ api, me, children }: { api: Api; me: Me; children: ReactNode }) {
  const enabled = !!me.scheduleOwnerEnabled && !!me.ownerUid && me.role !== "none";
  const [people, setPeople] = useState<Person[] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return setPeople(null);
    let live = true;
    api
      .call<{ people: Person[] }>("members.directory")
      .then((r) => live && setPeople(r.people))
      .catch(() => live && setPeople([]));
    // 临时链接 2 小时失效：每 100 分钟重新要一次
    const t = setInterval(() => setVersion((v) => v + 1), 100 * 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [api, enabled, version]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo<Directory>(() => {
    if (!enabled || !people) return OFF;
    const ownerUid = me.ownerUid!;
    const byUid = new Map(people.map((p) => [p.uid, p]));
    return {
      on: true,
      avatars: !!me.avatarsEnabled,
      ownerUid,
      meUid: me.uid,
      people,
      person: (uid) => (uid ? byUid.get(uid) : undefined),
      color: (uid) => memberColor(uid, ownerUid, (u) => byUid.get(u)?.color),
      name: (uid) =>
        !uid ? "不详" : uid.startsWith("system:") ? "系统" : (byUid.get(uid)?.name ?? (uid === ownerUid ? "Jason" : "已离开的成员")),
      ownerOf: (task) => taskOwner(task, ownerUid),
      refresh,
    };
  }, [enabled, people, me.ownerUid, me.uid, me.avatarsEnabled, refresh]);
  // 品牌复审的样式（members.css 整份）只挂在 html.so-on 下：开关关时不加这个类，页面与线上一模一样
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("so-on", value.on);
    return () => root.classList.remove("so-on");
  }, [value.on]);
  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

/** 头像：上传的图片或「成员色底 + 白色姓氏字」，外面一圈成员色；系统是空心圆环 */
export function MemberAvatar({ uid, size = 24, name: forced }: { uid: string | null | undefined; size?: number; name?: string }) {
  const dir = useDirectory();
  const [broken, setBroken] = useState("");
  const c = dir.color(uid);
  const p = dir.person(uid);
  const url = dir.avatars && p?.avatar?.url && broken !== p.avatar.url ? p.avatar.url : "";
  // 外圈 = 成员色（上传的照片也套），Jason 再加 1px 深珊瑚描边
  const ring = `0 0 0 1.5px #fff, 0 0 0 3px ${c.dot}${c === OWNER_COLOR ? `, 0 0 0 4px ${c.stroke}` : ""}`;
  // 固定正方形盒子 + 圆形裁切：任何父级 flex/grid 都不能把它拉成椭圆
  const style: CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    maxWidth: size,
    minHeight: size,
    maxHeight: size,
    fontSize: Math.round(size * 0.48),
  };
  if (c === SYSTEM_COLOR)
    return <span className="m-avatar system" style={{ ...style, borderColor: SYSTEM_COLOR.stroke }} aria-hidden="true" />;
  return (
    <span
      className="m-avatar"
      data-member-color={c.dot}
      style={{ ...style, background: url ? "#fff" : c.avatarBg, boxShadow: ring }}
      aria-hidden="true"
    >
      {url ? <img src={url} alt="" onError={() => setBroken(url)} /> : avatarInitial(forced ?? dir.name(uid))}
    </span>
  );
}
/** 色点（月历格子里用，不放头像）；Jason 带 1px 深色描边 */
export function MemberDot({ uid, title }: { uid: string | null | undefined; title?: string }) {
  const dir = useDirectory();
  const c = dir.color(uid);
  return (
    <i
      className="m-dot"
      title={title ?? dir.name(uid)}
      data-member-color={c.dot}
      style={{ background: c.dot, ...(c.stroke ? { boxShadow: `inset 0 0 0 1px ${c.stroke}` } : {}) }}
    />
  );
}
/** 归属标签：头像 + 名字，浅底深棕字（和状态胶囊区分开） */
export function MemberTag({ uid, size = 20, suffix }: { uid: string | null | undefined; size?: number; suffix?: ReactNode }) {
  const dir = useDirectory();
  const c = dir.color(uid);
  return (
    <span className="m-tag" style={{ background: c.tint, color: TAG_TEXT }} data-member-color={c.dot}>
      <MemberAvatar uid={uid} size={size} />
      <span className="m-tag-name">{dir.name(uid)}</span>
      {suffix}
    </span>
  );
}
/** 顶部「按成员看」：可多选；选中 = 白底 + 1.5px 深棕描边 + 加粗；未选 = 成员浅底 */
export function MemberFilter({
  selected,
  onChange,
  label = "按成员看",
}: {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  label?: string;
}) {
  const dir = useDirectory();
  if (!dir.on) return null;
  const toggle = (uid: string) => {
    const next = new Set(selected);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    onChange(next);
  };
  return (
    <div className="m-filter" role="group" aria-label={label}>
      <span className="m-filter-label">{label}</span>
      <div className="m-filter-chips">
        <button type="button" className={`m-chip ${selected.size ? "" : "on"}`} aria-pressed={!selected.size} onClick={() => onChange(new Set())}>
          全部
        </button>
        {dir.people
          .filter((p) => p.status === "active" || selected.has(p.uid))
          .map((p) => {
            const on = selected.has(p.uid);
            const c = dir.color(p.uid);
            return (
              <button
                key={p.uid}
                type="button"
                className={`m-chip ${on ? "on" : ""}`}
                aria-pressed={on}
                title={p.name}
                style={on ? undefined : { background: c.tint }}
                onClick={() => toggle(p.uid)}
              >
                <MemberAvatar uid={p.uid} size={22} />
                <span className="m-chip-name">{p.name}</span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
/** 指派选人（只有 Jason 用）：列出使用中的人 */
export function AssignPicker({ current, onPick, busy }: { current: string; onPick: (uid: string) => void; busy?: boolean }) {
  const dir = useDirectory();
  return (
    <ul className="m-picker" aria-label="指派给谁">
      {dir.people
        .filter((p) => p.status === "active")
        .map((p) => (
          <li key={p.uid}>
            <button type="button" disabled={busy || p.uid === current} onClick={() => onPick(p.uid)}>
              <MemberAvatar uid={p.uid} size={30} />
              <span className="m-picker-text">
                <b>{p.name}</b>
                <small>{p.uid === dir.ownerUid ? "同步到 Jason 的 iPhone 和 Notion" : "不同步到 iPhone"}</small>
              </span>
              {p.uid === current && <em>当前归属</em>}
            </button>
          </li>
        ))}
    </ul>
  );
}

/** 原生日期框跟浏览器语言走（英文系统会显示 mm/dd/yyyy）：旁边总是用中文再写一遍选中的日期。只在开关开时出现 */
export function zhDateText(value: string | undefined | null, kind: "date" | "month" | "datetime") {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return "";
  const [, y, mo, d, h, mi] = m;
  const base = `${y}年${Number(mo)}月`;
  if (kind === "month") return base;
  if (!d) return base;
  return kind === "datetime" && h ? `${base}${Number(d)}日 ${h}:${mi}` : `${base}${Number(d)}日`;
}
/** 开关开时把 YYYY-MM-DD 显示成「2026年11月12日」（short 时只显示「11月12日」）；开关关时原样显示 */
export function ZhDay({ value, short = false }: { value: string; short?: boolean }) {
  const dir = useDirectory();
  if (!dir.on) return <>{short ? value.slice(5) : value}</>;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return <>{short ? value.slice(5) : value}</>;
  const md = `${Number(m[2])}月${Number(m[3])}日`;
  return <>{short ? md : `${m[1]}年${md}`}</>;
}
export function ZhDateHint({ value, kind = "date" }: { value: string | undefined | null; kind?: "date" | "month" | "datetime" }) {
  const dir = useDirectory();
  const text = zhDateText(value, kind);
  if (!dir.on || !text) return null;
  return (
    <span className="zh-date" aria-hidden="true">
      {text}
    </span>
  );
}

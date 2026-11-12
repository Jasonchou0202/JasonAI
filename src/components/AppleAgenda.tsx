// 客户日程页「苹果官网风」卡片（2026-11 优化，照 Jason 22:43 确认的样稿）：
// 三张待办数字卡、今日日程横向卡片排、日程记录卡、客户搜索卡。功能全部接现有接口，不新增写入动作。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MemberAvatar, MemberDot, MemberTag, useDirectory, ZhDay } from "../lib/members-ui";
import { ArrowUpRight, ChevronRight, Search } from "lucide-react";
import type { Api } from "../domain/model";
import { displayCustomerName } from "../domain/customers";
import { QUADRANTS, QUADRANT_INFO, type Quadrant } from "../domain/insights";
import { QuadrantMark } from "../lib/insights-ui";
import {
  beijingDay,
  beijingInput,
  dayPlus,
  useCustomerMutation,
  type Customer,
  type CustomerMode,
  type CustomerTask,
} from "../lib/customer-ui";
import { ErrorNote } from "./ui";

const DAY = 86_400_000;
/** 卡片顶部的状态：待办（珊瑚）/ 已完成（绿）/ 逾期（红） */
export function appleState(task: CustomerTask, now: number) {
  if (task.deletedAt) return { tone: "deleted", text: "已删除" };
  if (task.completedAt)
    return {
      tone: "done",
      text: `已完成 ${beijingInput(task.completedAt).slice(11)}`,
    };
  const at = Date.parse(task.at);
  if (at < now) {
    const days = Math.floor(
      (Date.parse(`${beijingDay(new Date(now).toISOString())}T00:00:00+08:00`) -
        Date.parse(`${beijingDay(task.at)}T00:00:00+08:00`)) /
        DAY,
    );
    return { tone: "late", text: days > 0 ? `逾期 ${days} 天` : "已逾期" };
  }
  return { tone: "todo", text: "待办" };
}
/** 时间大字：今天只写时分，昨天/明天带前缀，其余带日期 */
export function appleTime(iso: string, now: number) {
  const today = beijingDay(new Date(now).toISOString());
  const day = beijingDay(iso),
    hm = beijingInput(iso).slice(11);
  if (day === today) return hm;
  if (day === dayPlus(today, -1)) return `昨天 ${hm}`;
  if (day === dayPlus(today, 1)) return `明天 ${hm}`;
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 ${hm}`;
}
export function QuadCapsules({ has }: { has?: ReadonlySet<Quadrant> }) {
  const so = useDirectory().on;
  const list = QUADRANTS.filter((q) => has?.has(q));
  if (!list.length) return null;
  return (
    <span className="apple-chips">
      {list.map((q) => (
        <span
          key={q}
          className="quad-capsule"
          style={so ? undefined : { ["--q" as string]: QUADRANT_INFO[q].color }}
        >
          {so && <QuadrantMark q={q} />}
          {QUADRANT_INFO[q].short}
        </span>
      ))}
    </span>
  );
}

/** 待办数字卡：大数字 + 一行说明，点开看这一组的完整日程 */
export function AppleStatCard({
  label,
  count,
  foot,
  tone,
  onOpen,
}: {
  label: string;
  count: number;
  foot: string;
  tone: "or" | "plain" | "red";
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="apple-card apple-stat"
      onClick={onOpen}
      aria-label={`${label} ${count} 条，${foot}，查看详情`}
    >
      <span className="apple-stat-arrow" aria-hidden="true">
        <ChevronRight size={15} />
      </span>
      <span className="apple-k">{label}</span>
      <span className={`apple-n ${tone}`}>{count}</span>
      <span className="apple-foot">{foot}</span>
    </button>
  );
}

/** 今日日程里的一张卡：顶部圆点+状态，大号时间，客户、事项、色块胶囊；底部两个按钮 */
export function AppleTaskCard({
  api,
  mode,
  task,
  now,
  customer,
  quadrants,
  onChange,
  onCustomer,
  onReschedule,
  onNext,
}: {
  api: Api;
  mode: CustomerMode;
  task: CustomerTask;
  now: number;
  customer?: Customer;
  quadrants?: ReadonlySet<Quadrant>;
  onChange: (msg: string) => void;
  onCustomer: (id: string, month?: string) => void;
  onReschedule: () => void;
  onNext: () => void;
}) {
  // 与原日程卡同一个本机待确认键：哪边点的，重试都能接上
  const mutation = useCustomerMutation(api, mode, `task-${task.id}`);
  const state = appleState(task, now);
  async function act(action: "complete" | "reopen") {
    if (
      await mutation.run(`tasks.${action}`, {
        id: task.id,
        revision: task.revision,
      })
    )
      onChange(action === "complete" ? "日程已完成" : "日程已重新打开");
  }
  const name = customer ? displayCustomerName(customer.name) : "查看客户";
  const dir = useDirectory();
  const owner = dir.on ? dir.ownerOf(task) : "";
  return (
    <article
      className={`apple-task ${state.tone} ${dir.on ? "has-owner-bar" : ""}`}
      data-task-id={task.id}
      style={dir.on ? ({ "--owner-bar": dir.color(owner).bar } as React.CSSProperties) : undefined}
    >
      <span className="apple-state">
        <i className="apple-dot" aria-hidden="true" />
        {state.text}
      </span>
      <time
        className={`apple-time ${appleTime(task.at, now).length > 8 ? "long" : ""}`}
        dateTime={task.at}
      >
        {appleTime(task.at, now)}
      </time>
      <button
        type="button"
        className="apple-who"
        title={name}
        onClick={() =>
          onCustomer(
            customer?.id || task.customerId,
            beijingDay(task.at).slice(0, 7),
          )
        }
      >
        {name}
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>
      <h3 className="apple-what" title={task.title}>
        {task.title}
      </h3>
      {(task.nextAction || task.feedback) && (
        <p className="apple-note" title={task.nextAction || task.feedback}>
          {task.nextAction
            ? `下一步：${task.nextAction}`
            : `反馈：${task.feedback}`}
        </p>
      )}
      <QuadCapsules has={quadrants} />
      {/* ①b 当天列表：3px 色条 + 归属人头像 */}
      {dir.on && (
        <div className="m-meta">
          <MemberTag uid={owner} />
          {task.updatedBy && (
            <span className="m-small">
              最后修改：
              <MemberAvatar uid={task.updatedBy} size={14} />
              {dir.name(task.updatedBy)}
            </span>
          )}
        </div>
      )}
      {mutation.error && <ErrorNote>{mutation.error}</ErrorNote>}
      <div className="apple-acts">
        {mutation.hasPending ? (
          <button
            type="button"
            className="apple-btn pri"
            disabled={mutation.busy}
            onClick={async () => {
              const p = mutation.pending;
              if (p && (await mutation.run(p.action, p.payload)))
                onChange("日程操作已确认");
            }}
          >
            {mutation.busy ? "重试中…" : "重试上次操作"}
          </button>
        ) : task.completedAt ? (
          <>
            <button
              type="button"
              className="apple-btn"
              disabled={mutation.busy}
              onClick={() => void act("reopen")}
            >
              重新打开
            </button>
            <button
              type="button"
              className="apple-btn"
              disabled={mutation.busy}
              onClick={onNext}
            >
              安排下一次
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="apple-btn pri"
              disabled={mutation.busy}
              onClick={() => void act("complete")}
            >
              完成
            </button>
            <button
              type="button"
              className="apple-btn"
              disabled={mutation.busy}
              onClick={onReschedule}
            >
              改期
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/** 横向滑动卡片排 + 分页点 */
export function AppleRail({
  children,
  count,
  label,
}: {
  children: ReactNode;
  count: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const n = Math.max(
        1,
        Math.ceil(el.scrollWidth / Math.max(el.clientWidth, 1) - 0.05),
      );
      setPages(n);
      const max = el.scrollWidth - el.clientWidth;
      setPage(max > 0 ? Math.round((el.scrollLeft / max) * (n - 1)) : 0);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [count]);
  function go(i: number) {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollTo({
      left: pages > 1 ? (max * i) / (pages - 1) : 0,
      behavior: "smooth",
    });
  }
  return (
    <>
      <div className="apple-rail" ref={ref} role="list" aria-label={label}>
        {children}
      </div>
      {pages > 1 && (
        <div className="apple-dots" role="group" aria-label="翻页">
          {Array.from({ length: pages }, (_, i) => (
            <button
              type="button"
              key={i}
              className={i === page ? "on" : ""}
              aria-label={`第 ${i + 1} 页`}
              aria-current={i === page ? "true" : undefined}
              onClick={() => go(i)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** 日程记录里的一行：日期 · 客户 · 事项 · 状态；点开展开完整日程卡（编辑、完成、删除、恢复都在里面） */
export function AppleLogRow({
  task,
  now,
  customer,
  open,
  onToggle,
  children,
}: {
  task: CustomerTask;
  now: number;
  customer?: Customer;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const state = appleState(task, now);
  const day = beijingDay(task.at);
  const name = customer ? displayCustomerName(customer.name) : "客户";
  const dir = useDirectory();
  return (
    <li className={`apple-log ${open ? "open" : ""}`}>
      <button
        type="button"
        className="apple-log-row"
        aria-expanded={open}
        onClick={onToggle}
        title={`${name} · ${task.title}`}
      >
        <span className="apple-log-d">
          {dir.on && <MemberDot uid={dir.ownerOf(task)} />} <ZhDay value={day} short />
        </span>
        <span className="apple-log-t">
          <b>{name}</b> · {task.title}
        </span>
        <span className={`apple-log-s ${state.tone}`}>
          {state.tone === "done"
            ? "完成"
            : state.tone === "late"
              ? "逾期"
              : state.tone === "deleted"
                ? "已删除"
                : "待办"}
        </span>
      </button>
      {open && <div className="apple-log-detail">{children}</div>}
    </li>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { useTeam } from "../lib/team-ui";
import { AssignPicker, MemberAvatar, MemberDot, MemberFilter, MemberTag, useDirectory } from "../lib/members-ui";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Check,
  RotateCcw,
  Trash2,
  ArrowUpRight,
  Search,
} from "lucide-react";
import type { Api } from "../domain/model";
import { displayCustomerName } from "../domain/customers";
import { customerChoices, matchesCustomer } from "../domain/catalog";
import { sortTasksTodayFirst } from "../domain/tasks";
import {
  beijingDay,
  beijingInput,
  beijingToUTC,
  calendarDays,
  currentMonth,
  customerRoot,
  dayPlus,
  shiftMonth,
  taskStatus,
  taskTone,
  useCustomerMutation,
  useCustomerQuery,
  type Customer,
  type CustomerMode,
  type CustomerTask,
} from "../lib/customer-ui";
import { TaskForm, type TaskDraft } from "./TaskForm";
import { ActionLibrary } from "./ActionLibrary";
import { QUADRANT_INFO, type Quadrant } from "../domain/insights";
import { Empty, ErrorNote, Loading, Modal } from "./ui";
import { useInsights } from "../lib/insights-ui";
import {
  AppleLogRow,
  AppleRail,
  AppleStatCard,
  AppleTaskCard,
  appleState,
} from "./AppleAgenda";
import "../customer.css";

export interface CalendarProps {
  api: Api;
  version: number;
  mode: CustomerMode;
  customerId?: string;
  onChange: (msg: string) => void;
  onCustomer: (id: string, month?: string) => void;
  taskId?: string;
  month?: string;
}
type Editor = { edit?: CustomerTask; draft?: TaskDraft; draftId?: string };
const NO_DELETED = { call: async <T,>() => [] as unknown as T };
export function Calendar(props: CalendarProps) {
  return (
    <CustomerCalendar
      key={`${props.mode}:${props.customerId || "all"}`}
      {...props}
    />
  );
}
function CustomerCalendar({
  api,
  version,
  mode,
  customerId,
  onChange,
  onCustomer,
  taskId,
  month: initialMonth,
}: CalendarProps) {
  const [month, setMonth] = useState(initialMonth || currentMonth);
  const [selected, setSelected] = useState(() =>
    initialMonth ? `${initialMonth}-01` : beijingDay(),
  );
  const [now, setNow] = useState(Date.now);
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<Editor>();
  const [focus, setFocus] = useState<CustomerTask>();
  const [search, setSearch] = useState("");
  const [filterCustomerId, setFilterCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const filterId = useId();
  const [history, setHistory] = useState<"all" | "completed" | "deleted">(
    "all",
  );
  // 苹果风日程记录卡默认 8 条一页（客户详情里的历史日程仍 20 条）
  const historyPage = customerId ? 20 : 8;
  const [historyLimit, setHistoryLimit] = useState(historyPage);
  // 苹果风：数字卡点开的分组（0 今日 / 1 明日 / 2 逾期 / 3 今日全部）、日程记录展开的行
  const [group, setGroup] = useState<number | null>(null);
  const [openLogs, setOpenLogs] = useState<Set<string>>(() => new Set());
  const { insights } = useInsights();
  const team = useTeam();
  const dir = useDirectory();
  // ④ 按成员看（多选）；开关关时永远是空集合 = 全部，与现在一致
  const [owners, setOwners] = useState<Set<string>>(() => new Set());
  const ownerMatch = (t: CustomerTask) => !dir.on || !owners.size || owners.has(dir.ownerOf(t));
  const effectiveCustomerId = customerId || filterCustomerId;
  const base = effectiveCustomerId ? { customerId: effectiveCustomerId } : {};
  const tasks = useCustomerQuery<CustomerTask[]>(
    api,
    "tasks.list",
    base,
    version,
    refresh,
  );
  // 日程回收站只给管理员：成员不发这个请求（云端同样会拒）
  const deleted = useCustomerQuery<CustomerTask[]>(
    team.isAdmin ? api : NO_DELETED,
    "tasks.list",
    { ...base, deleted: true },
    version,
    refresh,
  );
  const customers = useCustomerQuery<Customer[]>(
    api,
    "customers.list",
    {},
    version,
    refresh,
  );
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (initialMonth) {
      setMonth(initialMonth);
      setSelected(`${initialMonth}-01`);
    }
  }, [initialMonth]);
  const today = beijingDay(new Date(now).toISOString());
  const tomorrow = dayPlus(today, 1);
  const names = new Map(customers.data?.map((c) => [c.id, c]));
  const choices = customerChoices(customers.data || []);
  const matchingIds = new Set(
    choices.filter((c) => matchesCustomer(c, customerSearch)).map((c) => c.id),
  );
  const matchesName = (t: CustomerTask) =>
    !customerSearch.trim() ||
    matchingIds.has(customerRoot(customers.data || [], t.customerId));
  const activeTasks = (tasks.data || [])
    .filter((t) => !t.deletedAt && matchesName(t) && ownerMatch(t))
    .sort((a, b) => a.at.localeCompare(b.at));
  const grouped = new Map<string, CustomerTask[]>();
  for (const task of activeTasks) {
    const day = beijingDay(task.at);
    grouped.set(day, [...(grouped.get(day) || []), task]);
  }
  const days = calendarDays(month);
  const selectedTasks = grouped.get(selected) || [];
  function changed(msg: string) {
    setRefresh((v) => v + 1);
    onChange(msg);
  }
  function moveMonth(value: string) {
    if (/^\d{4}-\d{2}$/.test(value)) {
      setMonth(value);
      setSelected(value === today.slice(0, 7) ? today : `${value}-01`);
    }
  }
  function next(task: CustomerTask) {
    const day = dayPlus(
      beijingDay(task.at) < today ? today : beijingDay(task.at),
      1,
    );
    setFocus(undefined);
    setEditor({
      draftId: `next-${task.id}`,
      draft: {
        customerId: task.customerId,
        title: task.nextAction || task.title,
        at: beijingToUTC(`${day}T${beijingInput(task.at).slice(11)}`),
        reminder: task.reminder,
        feedback: "",
        nextAction: "",
      },
    });
  }
  function card(task: CustomerTask) {
    return (
      <TaskCard
        key={task.id}
        task={task}
        api={api}
        mode={mode}
        now={now}
        customer={names.get(
          customerRoot(customers.data || [], task.customerId),
        )}
        onChange={changed}
        onCustomer={onCustomer}
        onEdit={() => {
          setFocus(undefined);
          setEditor({ edit: task });
        }}
        onNext={() => next(task)}
      />
    );
  }
  function appleCard(task: CustomerTask) {
    const root = customerRoot(customers.data || [], task.customerId);
    return (
      <AppleTaskCard
        key={task.id}
        task={task}
        api={api}
        mode={mode}
        now={now}
        customer={names.get(root)}
        quadrants={insights?.customerQuadrants.get(root)}
        onChange={changed}
        onCustomer={onCustomer}
        onReschedule={() => {
          setFocus(undefined);
          setEditor({ edit: task });
        }}
        onNext={() => next(task)}
      />
    );
  }
  const upcoming = [
    {
      label: "今日待办",
      rows: activeTasks.filter(
        (t) =>
          !t.completedAt &&
          Date.parse(t.at) >= now &&
          beijingDay(t.at) === today,
      ),
    },
    {
      label: "明日待办",
      rows: activeTasks.filter(
        (t) => !t.completedAt && beijingDay(t.at) === tomorrow,
      ),
    },
    {
      label: customerId ? "逾期待跟进" : "逾期待办",
      rows: activeTasks.filter((t) => !t.completedAt && Date.parse(t.at) < now),
    },
  ];
  const query = search.trim().toLocaleLowerCase();
  const historyRows = (history === "deleted" ? deleted.data || [] : activeTasks)
    .filter(matchesName)
    .filter(ownerMatch)
    .filter((t) => history !== "completed" || Boolean(t.completedAt))
    .filter((t) => {
      const c = names.get(t.customerId);
      const root = names.get(customerRoot(customers.data || [], t.customerId));
      return (
        !query ||
        [
          c?.name,
          root?.name,
          ...(c?.aliases || []),
          t.title,
          t.feedback,
          t.nextAction,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)
      );
    });
  const orderedHistory = sortTasksTodayFirst(historyRows, today);
  // 客户搜索卡空着时：最近有日程的客户（按日程时间倒序去重，只读）
  const recentCustomers = (() => {
    const seen = new Set<string>();
    const out: Customer[] = [];
    for (const t of [...activeTasks].sort((a, b) => b.at.localeCompare(a.at))) {
      const root = customerRoot(customers.data || [], t.customerId);
      const c = names.get(root);
      if (!c || seen.has(root)) continue;
      seen.add(root);
      out.push(c);
      if (out.length >= 8) break;
    }
    return out;
  })();
  function statFoot(i: number, rows: CustomerTask[]) {
    if (!rows.length) return i === 2 ? "没有逾期，保持住" : "暂无日程";
    if (i === 0) {
      const n = rows[0];
      return `下一条 ${beijingInput(n.at).slice(11)} · ${n.title}`;
    }
    if (i === 1) return `最早 ${beijingInput(rows[0].at).slice(11)}`;
    const s = appleState(rows[0], now);
    return s.text === "已逾期" ? "最早一条今天已逾期" : `最早一条已${s.text}`;
  }
  // 日程记录卡：日程总页和客户详情页共用（详情页卡内自带搜索框）
  const historyCard = (
    <section
      className="apple-card customer-history apple-history"
      aria-labelledby="apple-history-title"
    >
      <div className="apple-sechead">
        <h2 id="apple-history-title" className="apple-sec small">
          {customerId ? "历史日程" : "日程记录"}
        </h2>
        <div className="segmented apple-seg">
          {(team.isAdmin ? (["all", "completed", "deleted"] as const) : (["all", "completed"] as const)).map((value, i) => (
            <button
              key={value}
              aria-pressed={history === value}
              className={history === value ? "active" : ""}
              onClick={() => {
                setHistory(value);
                setHistoryLimit(historyPage);
              }}
            >
              {["全部", "已完成", "回收站"][i]}
            </button>
          ))}
        </div>
      </div>
      {customerId && (
        <label className="apple-search-box">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索历史客户和日程"
            placeholder="搜索标题、反馈或下一步"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHistoryLimit(historyPage);
            }}
          />
        </label>
      )}
      {customers.error && customerId && (
        <ErrorNote>{customers.error}</ErrorNote>
      )}
      {query && (
        <p className="apple-foot">
          按「{search.trim()}」筛选 · {historyRows.length} 条
        </p>
      )}
      {history === "deleted" && deleted.error && (
        <>
          <ErrorNote>{deleted.error}</ErrorNote>
          <button
            className="text-button"
            onClick={() => setRefresh((v) => v + 1)}
          >
            重试读取回收站
          </button>
        </>
      )}
      {(history === "deleted" ? deleted.loading : tasks.loading) && <Loading />}
      {!(history === "deleted"
        ? deleted.loading || deleted.error
        : tasks.loading || tasks.error) &&
        (historyRows.length ? (
          <ul className="apple-logs">
            {orderedHistory.slice(0, historyLimit).map((task) => (
              <AppleLogRow
                key={task.id}
                task={task}
                now={now}
                customer={names.get(
                  customerRoot(customers.data || [], task.customerId),
                )}
                open={openLogs.has(task.id)}
                onToggle={() =>
                  setOpenLogs((s) => {
                    const n = new Set(s);
                    if (n.has(task.id)) n.delete(task.id);
                    else n.add(task.id);
                    return n;
                  })
                }
              >
                {card(task)}
              </AppleLogRow>
            ))}
          </ul>
        ) : (
          <p className="apple-foot apple-pad">没有符合条件的日程</p>
        ))}
      {historyRows.length > historyLimit && (
        <button
          className="apple-more customer-expand"
          onClick={() => setHistoryLimit((v) => v + historyPage)}
        >
          继续查看（还有 {historyRows.length - historyLimit} 条）
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      )}
    </section>
  );
  // 横排卡片：日程总页只放今天；客户详情页放「今天的 + 还没完成的 + 今天刚完成的」，免得详情页常常是空卡，点完成后也能就地重新打开
  const railTitle = customerId ? "今日日程与待跟进" : "今日日程";
  const railRows = customerId
    ? activeTasks.filter(
        (t) =>
          beijingDay(t.at) === today ||
          !t.completedAt ||
          beijingDay(t.completedAt) === today,
      )
    : grouped.get(today) || [];
  const customerResults = query
    ? choices.filter((c) => matchesCustomer(c, query))
    : [];
  return (
    <div
      className={`customer-ui customer-calendar-page apple-page ${customerId ? "apple-section" : ""}`}
    >
      <div
        className={`${customerId ? "section-heading" : "page-heading"} customer-heading`}
      >
        <div>
          <p className="eyebrow">记下约定，及时跟进</p>
          {customerId ? <h2>客户日程</h2> : <h1>跟进日历</h1>}
          <p className="subtle">北京时间 · 一次沟通，一次记录</p>
          {/* ⑨ 客户详情的「跟进人」：这位客户日程的归属人（只读） */}
          {dir.on && customerId && activeTasks.length > 0 && (
            <p className="m-meta" aria-label="跟进人">
              跟进人
              {[...new Set(activeTasks.map((t) => dir.ownerOf(t)))].map((uid) => (
                <MemberTag key={uid} uid={uid} size={18} />
              ))}
            </p>
          )}
        </div>
        {!customerId && (
          <dl className="hero-figures" aria-label="今日跟进">
            <div className="lead">
              <dt>今日跟进</dt>
              <dd>
                {(grouped.get(today) || []).length}
                <small> 次</small>
              </dd>
            </div>
          </dl>
        )}
        <button
          className="button primary"
          onClick={() =>
            setEditor({
              draftId: `day-${effectiveCustomerId || "all"}-${selected}`,
              draft: {
                customerId: effectiveCustomerId,
                at: beijingToUTC(`${selected}T09:00`),
              },
            })
          }
        >
          <Plus size={17} />
          新增日程
        </button>
      </div>
      {!customerId && (
        <div className="panel customer-calendar-filter">
          <label htmlFor={filterId}>按客户查看</label>
          <select
            id={filterId}
            value={filterCustomerId}
            onChange={(e) => {
              setFilterCustomerId(e.target.value);
              setCustomerSearch("");
              setHistoryLimit(historyPage);
            }}
          >
            <option value="">全部客户</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="search"
            aria-label="输入客户名字查找日程"
            placeholder="直接输入客户名字或别名"
            value={customerSearch}
            onChange={(e) => {
              setCustomerSearch(e.target.value);
              setFilterCustomerId("");
              setHistoryLimit(historyPage);
            }}
          />
          <span className="subtle">月历、待办和历史记录同步筛选</span>
        </div>
      )}
      {dir.on && !customerId && (
        <div className="panel m-filter-panel">
          <MemberFilter
            selected={owners}
            onChange={(next) => {
              setOwners(next);
              setHistoryLimit(historyPage);
            }}
          />
        </div>
      )}
      {taskId && (
        <RoutedTask
          key={taskId}
          api={api}
          version={version}
          refresh={refresh}
          id={taskId}
          customerId={customerId}
          customers={customers.data}
          onOpen={(task) => {
            setFocus(task);
            if (!customerId) setFilterCustomerId("");
            setMonth(beijingDay(task.at).slice(0, 7));
            setSelected(beijingDay(task.at));
          }}
        />
      )}
      <>
        <div className="apple-stats" role="group" aria-label="待办概览">
          {upcoming.map((g, i) => (
            <AppleStatCard
              key={g.label}
              label={g.label}
              count={g.rows.length}
              tone={i === 0 ? "or" : i === 2 ? "red" : "plain"}
              foot={tasks.loading ? "正在读取…" : statFoot(i, g.rows)}
              onOpen={() => setGroup(i)}
            />
          ))}
        </div>
        <section
          className="customer-today apple-today"
          aria-labelledby="apple-today-title"
        >
          <div className="apple-sechead">
            <h2 id="apple-today-title" className="apple-sec">
              {railTitle} <small>{today}</small>
            </h2>
            {railRows.length > 0 && (
              <button
                type="button"
                className="apple-more"
                onClick={() => setGroup(3)}
              >
                全部 {railRows.length} 条{" "}
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          {tasks.loading ? (
            <Loading />
          ) : tasks.error ? (
            <ErrorNote>{tasks.error}</ErrorNote>
          ) : railRows.length ? (
            <AppleRail
              count={railRows.length}
              label={`${railTitle}卡片，左右滑动查看`}
            >
              {railRows.map(appleCard)}
            </AppleRail>
          ) : (
            <div className="apple-card apple-empty">
              {customerId ? "今天没有日程，也没有待跟进的日程" : "今天没有日程"}
            </div>
          )}
        </section>
      </>
      <section className="panel customer-calendar">
        <div className="panel-heading customer-heading">
          <div>
            <h2>
              <CalendarDays size={17} /> 月历
            </h2>
            <p>点击日期查看反馈和下一步</p>
          </div>
          <div className="customer-month">
            <button
              className="icon-button"
              aria-label="日历上个月"
              onClick={() => moveMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <input
              type="month"
              aria-label="日历月份"
              value={month}
              onChange={(e) => moveMonth(e.target.value)}
            />
            <button
              className="icon-button"
              aria-label="日历下个月"
              onClick={() => moveMonth(shiftMonth(month, 1))}
            >
              <ChevronRight size={18} />
            </button>
            <button
              className="text-button"
              onClick={() => {
                setMonth(currentMonth());
                setSelected(today);
              }}
            >
              今天
            </button>
          </div>
        </div>
        <div className="customer-legend">
          <span className="task-complete">● 已完成</span>
          <span className="task-urgent">● 今明未到</span>
          <span className="task-pending">● 逾期 / 待办</span>
          <small>完成 / 总数</small>
        </div>
        {tasks.error && (
          <div className="customer-pad">
            <ErrorNote>{tasks.error}</ErrorNote>
            <button
              className="text-button"
              onClick={() => setRefresh((v) => v + 1)}
            >
              重新读取日程
            </button>
          </div>
        )}
        {tasks.loading && <Loading />}
        <div
          className="customer-calendar-grid"
          role="group"
          aria-label={`${month} 月历，北京时间`}
        >
          {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
            <span className="customer-weekday" key={day}>
              周{day}
            </span>
          ))}
          {days.map((day) => {
            const dayTasks = grouped.get(day) || [];
            const counts = { complete: 0, urgent: 0, pending: 0 };
            dayTasks.forEach((t) => counts[taskTone(t, now)]++);
            return (
              <button
                key={day}
                className={`customer-day ${dayTasks.length ? "" : "empty-day"} ${day.startsWith(month) ? "" : "outside"} ${day === today ? "today" : ""} ${day === selected ? "selected" : ""}`}
                aria-pressed={day === selected}
                aria-label={`${day}，已完成${counts.complete}，今明未到${counts.urgent}，逾期或待办${counts.pending}，共${dayTasks.length}条`}
                onClick={() => {
                  setSelected(day);
                  if (!day.startsWith(month)) setMonth(day.slice(0, 7));
                }}
              >
                <span className="customer-day-number">
                  {Number(day.slice(8))}
                  {day === today && <i />}
                </span>
                {dayTasks.length > 0 && (
                  <>
                    <span className="customer-day-counts">
                      {(["complete", "urgent", "pending"] as const).map(
                        (tone) => (
                          <span key={tone} className={`task-${tone}`}>
                            <i />
                            {counts[tone]}
                          </span>
                        ),
                      )}
                    </span>
                    <small className="customer-day-total">
                      {counts.complete}/{dayTasks.length}
                    </small>
                    {/* ①a 月历格子只放归属人色点（最多 4 个，多了 +n），不放头像 */}
                    {dir.on && (
                      <span className="m-dots" aria-label={`归属：${[...new Set(dayTasks.map((t) => dir.name(dir.ownerOf(t))))].join("、")}`}>
                        {dayTasks.slice(0, 4).map((t) => (
                          <MemberDot key={t.id} uid={dir.ownerOf(t)} />
                        ))}
                        {dayTasks.length > 4 && <small>+{dayTasks.length - 4}</small>}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </section>
      {selected !== today && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{selected.replaceAll("-", " / ")} · 日程</h2>
              <p>{selectedTasks.length} 次跟进</p>
            </div>
          </div>
          {!tasks.loading &&
            !tasks.error &&
            (selectedTasks.length ? (
              <div className="customer-task-list">
                {selectedTasks.map(card)}
              </div>
            ) : (
              <Empty title="这一天没有日程">
                点击新增日程，记下下一次沟通。
              </Empty>
            ))}
        </section>
      )}
      {customerId ? (
        historyCard
      ) : (
        <div className="apple-bottom">
          {historyCard}
          <section
            className="apple-card apple-search"
            aria-labelledby="apple-search-title"
          >
            <h2 id="apple-search-title" className="apple-sec small">
              客户搜索
            </h2>
            <label className="apple-search-box">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                aria-label="搜索历史客户和日程"
                placeholder="输入客户名称、别名、反馈或下一步"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHistoryLimit(historyPage);
                }}
              />
            </label>
            {customers.error && <ErrorNote>{customers.error}</ErrorNote>}
            <p className="apple-foot">
              {query
                ? `匹配的客户 · ${customerResults.length} 位`
                : "最近有日程的客户"}
            </p>
            <div className="apple-avatars customer-search-results">
              {(query ? customerResults : recentCustomers)
                .slice(0, query ? 30 : 8)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="apple-av"
                    title={displayCustomerName(c.name)}
                    onClick={() =>
                      onCustomer(customerRoot(customers.data || [], c.id))
                    }
                  >
                    <b aria-hidden="true">
                      {Array.from(displayCustomerName(c.name))[0] ?? "?"}
                    </b>
                    <span>{displayCustomerName(c.name)}</span>
                  </button>
                ))}
              {query && !customerResults.length && (
                <span className="apple-foot">没有匹配的客户</span>
              )}
            </div>
            <p className="apple-foot">日程记录会同步按这里的关键词筛选</p>
          </section>
        </div>
      )}
      {!customerId && (
        <ActionLibrary
          mode={mode}
          focus={
            (new URLSearchParams(location.hash.split("?")[1] || "").get(
              "actions",
            ) || undefined) as Quadrant | undefined
          }
          onSchedule={(a) =>
            setEditor({
              draftId: `action-${a.id}-${selected}`,
              draft: {
                customerId: effectiveCustomerId,
                at: beijingToUTC(`${selected}T09:00`),
                title: `【${QUADRANT_INFO[a.quadrant].short}】${a.text}`.slice(
                  0,
                  200,
                ),
              },
            })
          }
        />
      )}
      {group !== null && (
        <Modal
          title={
            group === 3 ? `${railTitle} · ${today}` : upcoming[group].label
          }
          onClose={() => setGroup(null)}
        >
          <div className="customer-ui">
            {(group === 3 ? railRows : upcoming[group].rows).length ? (
              <div className="customer-task-list apple-modal-list">
                {(group === 3 ? railRows : upcoming[group].rows).map(card)}
              </div>
            ) : (
              <p className="customer-pad subtle">暂无日程</p>
            )}
          </div>
        </Modal>
      )}
      {editor && (
        <Modal
          title={editor.edit ? "编辑跟进日程" : "新增跟进日程"}
          onClose={() => setEditor(undefined)}
        >
          <TaskForm
            api={api}
            version={version + refresh}
            mode={mode}
            customerId={effectiveCustomerId}
            {...editor}
            onCancel={() => setEditor(undefined)}
            onSaved={(msg) => {
              setEditor((current) =>
                current === editor ? undefined : current,
              );
              changed(msg);
            }}
          />
        </Modal>
      )}
      {focus && (
        <Modal title="跟进日程" onClose={() => setFocus(undefined)}>
          <div className="customer-ui">
            {card(
              activeTasks.find((t) => t.id === focus.id) ||
                deleted.data?.find((t) => t.id === focus.id) ||
                focus,
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function RoutedTask({
  api,
  version,
  refresh,
  id,
  customerId,
  customers,
  onOpen,
}: {
  api: Api;
  version: number;
  refresh: number;
  id: string;
  customerId?: string;
  customers?: Customer[];
  onOpen: (task: CustomerTask) => void;
}) {
  const { data, loading, error } = useCustomerQuery<CustomerTask>(
    api,
    "tasks.get",
    { id },
    version,
    refresh,
  );
  const opened = useRef(false);
  const matches =
    !customerId ||
    Boolean(
      customers &&
      customerRoot(customers, data?.customerId || "") ===
        customerRoot(customers, customerId),
    );
  useEffect(() => {
    if (data && !opened.current && matches) {
      opened.current = true;
      onOpen(data);
    }
  }, [data, matches, onOpen]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (loading) return <Loading />;
  if (data && customers && !matches)
    return <ErrorNote>这条日程属于其他客户，请从全部日历打开。</ErrorNote>;
  return null;
}
function TaskCard({
  api,
  mode,
  task,
  now,
  customer,
  onChange,
  onCustomer,
  onEdit,
  onNext,
}: {
  api: Api;
  mode: CustomerMode;
  task: CustomerTask;
  now: number;
  customer?: Customer;
  onChange: (msg: string) => void;
  onCustomer: (id: string, month?: string) => void;
  onEdit: () => void;
  onNext: () => void;
}) {
  const team = useTeam();
  const dir = useDirectory();
  const mutation = useCustomerMutation(api, mode, `task-${task.id}`);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [ownerDialog, setOwnerDialog] = useState<"" | "claim" | "assign" | "delete">("");
  const owner = dir.on ? dir.ownerOf(task) : "";
  const creator = task.createdBy || dir.ownerUid;
  async function transfer(to?: string) {
    const ok = await mutation.run(to ? "tasks.assign" : "tasks.claim", {
      id: task.id,
      revision: task.revision,
      ...(to ? { to } : {}),
    });
    if (ok) {
      setOwnerDialog("");
      onChange(to ? `日程已指派给${dir.name(to)}` : "日程已认领到你名下");
    }
  }
  async function act(action: string) {
    if (
      await mutation.run(`tasks.${action}`, {
        id: task.id,
        revision: task.revision,
      })
    )
      onChange(
        (
          {
            complete: "日程已完成",
            reopen: "日程已重新打开",
            delete: "日程已移入回收站",
            restore: "日程已恢复",
            purge: "日程已彻底删除",
          } as Record<string, string>
        )[action] || "日程已更新",
      );
  }
  return (
    <article
      className={`customer-task task-${taskTone(task, now)} ${task.deletedAt ? "deleted" : ""} ${dir.on ? "has-owner-bar" : ""}`}
      style={dir.on ? ({ "--owner-bar": dir.color(owner).bar } as React.CSSProperties) : undefined}
    >
      <div className="customer-task-top">
        <time dateTime={task.at}>
          {beijingInput(task.at).replace("T", " ")}
        </time>
        <span className="customer-task-status">{taskStatus(task, now)}</span>
      </div>
      <h3>{task.title}</h3>
      <button
        className="text-button customer-task-customer"
        onClick={() =>
          onCustomer(
            customer?.id || task.customerId,
            beijingDay(task.at).slice(0, 7),
          )
        }
      >
        {customer ? displayCustomerName(customer.name) : "查看客户"}
        <ArrowUpRight size={13} />
      </button>
      {task.feedback && (
        <p className="customer-task-text">
          <strong>反馈</strong>
          {task.feedback}
        </p>
      )}
      {task.nextAction && (
        <p className="customer-task-text">
          <strong>下一步</strong>
          {task.nextAction}
        </p>
      )}
      {dir.on && (
        /* ②a/②b 归属人、创建人、最后修改人；⑩ 回收站里显示谁删的 */
        <dl className="m-detail" aria-label="日程归属">
          <dt>归属人</dt>
          <dd>
            <MemberTag uid={owner} />
            <small className="subtle">{owner === dir.ownerUid ? "同步到 Jason 的 iPhone 和 Notion" : "不同步到 iPhone"}</small>
          </dd>
          <dt>创建人</dt>
          <dd>
            <MemberTag uid={creator} size={18} />
          </dd>
          {task.deletedAt ? (
            <>
              <dt>谁删的</dt>
              <dd>{task.updatedBy ? <MemberTag uid={task.updatedBy} size={18} /> : <span className="subtle">不详</span>}</dd>
            </>
          ) : (
            task.updatedBy && (
              <>
                <dt>最后修改</dt>
                <dd>
                  <MemberTag uid={task.updatedBy} size={18} />
                  <small className="subtle">{beijingInput(task.updatedAt).slice(5).replace("T", " ")}</small>
                </dd>
              </>
            )
          )}
        </dl>
      )}
      <small className="subtle">
        {task.reminder === "off"
          ? "提醒已关闭"
          : task.reminder === "due"
            ? "到时提醒"
            : "提前 + 到时提醒"}
      </small>
      {mutation.error && <ErrorNote>{mutation.error}</ErrorNote>}
      <div className="customer-task-actions">
        {mutation.hasPending ? (
          <button
            className="button secondary"
            disabled={mutation.busy}
            onClick={async () => {
              const p = mutation.pending;
              if (p && (await mutation.run(p.action, p.payload)))
                onChange("日程操作已确认");
            }}
          >
            {mutation.busy ? "重试中…" : "重试上次操作"}
          </button>
        ) : task.deletedAt ? (
          <>
            <button
              className="text-button"
              disabled={mutation.busy}
              onClick={() => void act("restore")}
            >
              <RotateCcw size={14} />
              恢复
            </button>
            {confirmPurge ? (
              <button
                className="text-button negative"
                disabled={mutation.busy}
                onClick={() => void act("purge")}
              >
                确认彻底删除（不可恢复）
              </button>
            ) : (
              <button
                className="text-button negative"
                disabled={mutation.busy}
                onClick={() => setConfirmPurge(true)}
              >
                彻底删除
              </button>
            )}
          </>
        ) : (
          <>
            <button
              className="text-button"
              disabled={mutation.busy}
              onClick={onEdit}
            >
              <Pencil size={14} />
              编辑
            </button>
            <button
              className="text-button"
              disabled={mutation.busy}
              onClick={() => void act(task.completedAt ? "reopen" : "complete")}
            >
              {task.completedAt ? <RotateCcw size={14} /> : <Check size={14} />}
              {task.completedAt ? "重开" : "完成"}
            </button>
            <button
              className="text-button"
              disabled={mutation.busy}
              onClick={onNext}
            >
              <Plus size={14} />
              安排下一次
            </button>
            {/* ③ 认领：任何人把别人的日程转到自己名下；指派：只有 Jason */}
            {dir.on && owner !== dir.meUid && (
              <button className="text-button" disabled={mutation.busy} onClick={() => setOwnerDialog("claim")}>
                认领
              </button>
            )}
            {dir.on && team.isAdmin && (
              <button className="text-button" disabled={mutation.busy} onClick={() => setOwnerDialog("assign")}>
                指派
              </button>
            )}
            {/* 开关关：成员只在自己建的日程上看到删除（没有录入人 = 管理员建的，藏起来）；开关开：所有人都能删（进回收站）。真正的拦截在云端 */}
            {(dir.on || team.canChange(task)) && (
              <button
                className="text-button negative"
                disabled={mutation.busy}
                onClick={() => (dir.on && owner !== dir.meUid ? setOwnerDialog("delete") : void act("delete"))}
              >
                <Trash2 size={14} />
                删除
              </button>
            )}
          </>
        )}
      </div>
      {ownerDialog && (
        <Modal
          title={ownerDialog === "claim" ? "认领这条日程" : ownerDialog === "assign" ? "指派给…" : "删除别人的日程"}
          onClose={() => setOwnerDialog("")}
        >
          <div className="m-confirm">
            {ownerDialog === "assign" ? (
              <>
                <p>
                  现在归 <MemberTag uid={owner} />。指派给 Jason 会加回 iPhone；指派给成员会从 Jason 的 iPhone 删除。
                </p>
                <AssignPicker current={owner} busy={mutation.busy} onPick={(uid) => void transfer(uid)} />
              </>
            ) : (
              <>
                <p>
                  {ownerDialog === "claim" ? (
                    <>
                      这条日程现在归 <MemberTag uid={owner} />，认领后归你。
                      {owner === dir.ownerUid && <b> 认领后会从 Jason 的 iPhone 删除。</b>}
                    </>
                  ) : (
                    <>
                      这条日程归 <MemberTag uid={owner} />。删除后进回收站，只有 Jason 能恢复；操作日志会记下是你删的。
                    </>
                  )}
                </p>
                <div className="team-row">
                  <button className="button secondary" onClick={() => setOwnerDialog("")}>
                    取消
                  </button>
                  <button
                    className={`button ${ownerDialog === "delete" ? "danger" : "primary"}`}
                    disabled={mutation.busy}
                    onClick={() => (ownerDialog === "claim" ? void transfer() : void act("delete").then(() => setOwnerDialog("")))}
                  >
                    {ownerDialog === "claim" ? "确认认领" : "确认删除"}
                  </button>
                </div>
              </>
            )}
            {mutation.error && <ErrorNote>{mutation.error}</ErrorNote>}
          </div>
        </Modal>
      )}
    </article>
  );
}

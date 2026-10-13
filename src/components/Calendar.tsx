import { useEffect, useId, useRef, useState } from "react";
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
} from "lucide-react";
import type { Api } from "../domain/model";
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
import { Empty, ErrorNote, Loading, Modal } from "./ui";
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
  const filterId = useId();
  const [history, setHistory] = useState<"all" | "completed" | "deleted">(
    "all",
  );
  const [historyLimit, setHistoryLimit] = useState(20);
  const effectiveCustomerId = customerId || filterCustomerId;
  const base = effectiveCustomerId ? { customerId: effectiveCustomerId } : {};
  const tasks = useCustomerQuery<CustomerTask[]>(
    api,
    "tasks.list",
    base,
    version,
    refresh,
  );
  const deleted = useCustomerQuery<CustomerTask[]>(
    api,
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
  const activeTasks = (tasks.data || [])
    .filter((t) => !t.deletedAt)
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
  const upcoming = [
    {
      label: "逾期待跟进",
      rows: activeTasks.filter((t) => !t.completedAt && Date.parse(t.at) < now),
    },
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
  ];
  const query = search.trim().toLocaleLowerCase();
  const historyRows = (history === "deleted" ? deleted.data || [] : activeTasks)
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
    })
    .sort((a, b) => b.at.localeCompare(a.at));
  const customerResults = query
    ? customers.data?.filter((c) =>
        [c.name, ...(c.aliases || [])]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query),
      )
    : [];
  return (
    <div className="customer-ui customer-calendar-page">
      <div className="page-heading customer-heading">
        <div>
          <p className="eyebrow">记下约定，及时跟进</p>
          <h1>{customerId ? "客户日程" : "跟进日历"}</h1>
          <p className="subtle">北京时间 · 一次沟通，一次记录</p>
        </div>
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
              setHistoryLimit(20);
            }}
          >
            <option value="">全部客户</option>
            {customers.data
              ?.filter((c) => !c.mergedInto)
              .map((c) => {
                const aliases = customers
                  .data!.filter(
                    (a) =>
                      a.id !== c.id &&
                      customerRoot(customers.data!, a.id) === c.id,
                  )
                  .map((a) => a.name);
                return (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {aliases.length ? `（含 ${aliases.join("、")}）` : ""}
                  </option>
                );
              })}
          </select>
          <span className="subtle">月历、待办和历史记录同步筛选</span>
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
                  </>
                )}
              </button>
            );
          })}
        </div>
      </section>
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
            <div className="customer-task-list">{selectedTasks.map(card)}</div>
          ) : (
            <Empty title="这一天没有日程">点击新增日程，记下下一次沟通。</Empty>
          ))}
      </section>
      {!customerId && (
        <div className="customer-agenda">
          {upcoming.map((group) => (
            <section className="panel" key={group.label}>
              <div className="panel-heading">
                <div>
                  <h2>{group.label}</h2>
                  <p>{group.rows.length} 条未完成</p>
                </div>
              </div>
              {!tasks.loading &&
                !tasks.error &&
                (group.rows.length ? (
                  <div className="customer-task-list">
                    {group.rows.map(card)}
                  </div>
                ) : (
                  <p className="customer-pad subtle">暂无日程</p>
                ))}
            </section>
          ))}
        </div>
      )}
      <section className="panel customer-history">
        <div className="panel-heading customer-heading">
          <div>
            <h2>{customerId ? "历史日程" : "日程记录与客户搜索"}</h2>
            <p>保留反馈、下一步与已完成的沟通记录</p>
          </div>
        </div>
        <div className="customer-history-tools">
          <input
            type="search"
            aria-label="搜索历史客户和日程"
            placeholder="搜索客户、反馈或下一步"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHistoryLimit(20);
            }}
          />
          <div className="segmented">
            {(["all", "completed", "deleted"] as const).map((value, i) => (
              <button
                key={value}
                aria-pressed={history === value}
                className={history === value ? "active" : ""}
                onClick={() => {
                  setHistory(value);
                  setHistoryLimit(20);
                }}
              >
                {["全部", "已完成", "回收站"][i]}
              </button>
            ))}
          </div>
        </div>
        {customers.error && (
          <div className="customer-pad">
            <ErrorNote>{customers.error}</ErrorNote>
          </div>
        )}
        {!customerId && Boolean(customerResults?.length) && (
          <div className="customer-search-results">
            {customerResults?.map((c) => (
              <button
                key={c.id}
                className="button secondary"
                onClick={() =>
                  onCustomer(customerRoot(customers.data || [], c.id))
                }
              >
                {c.name}
                {c.mergedInto ? "（已合并）" : ""}
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        )}
        {history === "deleted" && deleted.error && (
          <div className="customer-pad">
            <ErrorNote>{deleted.error}</ErrorNote>
            <button
              className="text-button"
              onClick={() => setRefresh((v) => v + 1)}
            >
              重试读取回收站
            </button>
          </div>
        )}
        {(history === "deleted" ? deleted.loading : tasks.loading) && (
          <Loading />
        )}
        {!(history === "deleted"
          ? deleted.loading || deleted.error
          : tasks.loading || tasks.error) &&
          (historyRows.length ? (
            <div className="customer-task-list">
              {historyRows.slice(0, historyLimit).map(card)}
            </div>
          ) : (
            <Empty title="没有符合条件的日程" />
          ))}
        {historyRows.length > historyLimit && (
          <button
            className="text-button customer-expand"
            onClick={() => setHistoryLimit((v) => v + 20)}
          >
            继续查看历史（还有 {historyRows.length - historyLimit} 条）
          </button>
        )}
      </section>
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
  const mutation = useCustomerMutation(api, mode, `task-${task.id}`);
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
          } as Record<string, string>
        )[action] || "日程已更新",
      );
  }
  return (
    <article
      className={`customer-task task-${taskTone(task, now)} ${task.deletedAt ? "deleted" : ""}`}
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
        {customer?.name || "查看客户"}
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
          <button
            className="text-button"
            disabled={mutation.busy}
            onClick={() => void act("restore")}
          >
            <RotateCcw size={14} />
            恢复
          </button>
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
              下一次
            </button>
            <button
              className="text-button negative"
              disabled={mutation.busy}
              onClick={() => void act("delete")}
            >
              <Trash2 size={14} />
              删除
            </button>
          </>
        )}
      </div>
    </article>
  );
}

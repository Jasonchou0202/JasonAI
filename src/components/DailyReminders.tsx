import { useEffect, useState } from "react";
import { ArrowUpRight, Bell, CalendarDays, RefreshCw } from "lucide-react";
import type { Api, Customer, CustomerTask } from "../domain/model";
import { dailyPendingTasks } from "../domain/tasks";
import { today } from "../domain/dates";
import { displayCustomerName } from "../domain/customers";
import { beijingInput, customerRoot, taskStatus } from "../lib/customer-ui";
import { ErrorNote, Loading, Modal, message, useQuery } from "./ui";

export function DailyReminders({
  api,
  version,
  onOpenTask,
  onOpenCalendar,
}: {
  api: Api;
  version: number;
  onOpenTask: (id: string) => void;
  onOpenCalendar: () => void;
}) {
  const [day, setDay] = useState(today);
  const [snapshot, setSnapshot] = useState<{
    day: string;
    rows: CustomerTask[];
  }>();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true,
      pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const rows = await api.call<CustomerTask[]>("tasks.list", {
          from: day,
          to: day,
        });
        if (alive) {
          setSnapshot({ day, rows });
          setError("");
        }
      } catch (e) {
        if (alive) setError(message(e));
      } finally {
        pending = false;
      }
    }
    function check() {
      if (document.visibilityState === "hidden") return;
      const current = today();
      if (current !== day) setDay(current);
      else void load();
    }
    void load();
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [api, version, day, refresh]);
  const ready = snapshot?.day === day;
  const rows = ready ? dailyPendingTasks(snapshot.rows, day) : [];
  const count = rows.length;
  const label = error
    ? "日常提醒，暂时无法更新"
    : !ready
      ? "日常提醒，正在读取"
      : `日常提醒，今日 ${count} 条待办`;
  function show() {
    setDay(today());
    setRefresh((v) => v + 1);
    setOpen(true);
  }
  return (
    <>
      <button
        className={`daily-reminder-button ${count && !error ? "has-tasks" : ""}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
      >
        <Bell size={19} aria-hidden="true" />
        <span className="daily-reminder-label">日常提醒</span>
        <span
          className={`daily-reminder-count ${!count || error ? "neutral" : ""}`}
          aria-hidden="true"
        >
          {error ? "!" : !ready ? "…" : count > 99 ? "99+" : count}
        </span>
      </button>
      {open && (
        <Modal title="今日待办" onClose={() => setOpen(false)}>
          <div className="daily-reminder-summary">
            <span>{day} · 北京时间</span>
            <strong aria-live="polite">
              {error ? "更新失败" : ready ? `${count} 条未完成` : "正在读取…"}
            </strong>
          </div>
          <p className="subtle">
            包含今天已逾期的事项；已完成及已删除的事项不计入。
          </p>
          {error ? (
            <>
              <ErrorNote>暂时无法更新今日待办，请联网后重试。{error}</ErrorNote>
              <button
                className="button secondary"
                onClick={() => setRefresh((v) => v + 1)}
              >
                <RefreshCw size={16} />
                重试
              </button>
            </>
          ) : !ready ? (
            <Loading />
          ) : rows.length ? (
            <DailyTaskList
              api={api}
              rows={rows}
              onOpen={(id) => {
                setOpen(false);
                onOpenTask(id);
              }}
            />
          ) : (
            <div className="daily-reminder-empty">
              <Bell size={25} />
              <strong>今天没有未完成事项</strong>
              <p>可以在客户日程中安排下一次跟进。</p>
            </div>
          )}
          <div className="form-actions daily-reminder-actions">
            <button
              className="button primary"
              onClick={() => {
                setOpen(false);
                onOpenCalendar();
              }}
            >
              <CalendarDays size={16} />
              打开日程总览
            </button>
            <button
              className="text-button"
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={15} />
              刷新待办
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function DailyTaskList({
  api,
  rows,
  onOpen,
}: {
  api: Api;
  rows: CustomerTask[];
  onOpen: (id: string) => void;
}) {
  const customers = useQuery<Customer[]>(api, "customers.list", {});
  const names = new Map(customers.data?.map((c) => [c.id, c]));
  return (
    <ul className="daily-reminder-list" aria-label="今日未完成日程">
      {rows.map((task) => {
        const customer = names.get(
          customerRoot(customers.data || [], task.customerId),
        );
        const overdue = Date.parse(task.at) < Date.now();
        return (
          <li key={task.id}>
            <button
              className="daily-reminder-row"
              onClick={() => onOpen(task.id)}
            >
              <time dateTime={task.at}>{beijingInput(task.at).slice(11)}</time>
              <span className="daily-reminder-copy">
                <strong>{task.title}</strong>
                <small>
                  {customer
                    ? displayCustomerName(customer.name)
                    : customers.error
                      ? "客户名称暂未加载"
                      : customers.data
                        ? "客户日程"
                        : "正在读取客户…"}
                </small>
              </span>
              <span
                className={`daily-reminder-state ${overdue ? "overdue" : ""}`}
              >
                {taskStatus(task)}
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { Save } from "lucide-react";
import type { Api } from "../domain/model";
import { displayCustomerName } from "../domain/customers";
import {
  beijingInput,
  beijingToUTC,
  readLocal,
  removeLocal,
  writeLocal,
  useCustomerQuery,
  useCustomerMutation,
  type Customer,
  type CustomerMode,
  type CustomerTask,
  type TaskInput,
} from "../lib/customer-ui";
import { ErrorNote, message } from "./ui";
import "../customer.css";

export type TaskDraft = Partial<TaskInput>;
interface StoredDraft {
  input: TaskInput;
  revision?: number;
  wallTime?: string;
}
export interface TaskFormProps {
  api: Api;
  version?: number;
  mode: CustomerMode;
  customerId?: string;
  edit?: CustomerTask;
  draft?: TaskDraft;
  draftId?: string;
  onSaved: (msg: string) => void;
  onCancel: () => void;
}
export function TaskForm(props: TaskFormProps) {
  // Remount when identity changes; never carry another customer's draft into this form.
  return (
    <TaskEditor
      key={`${props.mode}:${props.edit?.id || props.draftId || props.customerId || "new"}`}
      {...props}
    />
  );
}
function TaskEditor({
  api,
  version = 0,
  mode,
  customerId,
  edit,
  draft,
  draftId,
  onSaved,
  onCancel,
}: TaskFormProps) {
  const scope = edit?.id || `new-${draftId || customerId || "all"}`;
  const key = `zhangyuge-task-draft-${mode}-${scope}`;
  const original = (): StoredDraft => ({
    input: {
      customerId: edit?.customerId || draft?.customerId || customerId || "",
      at: edit?.at || draft?.at || new Date().toISOString(),
      title: edit?.title || draft?.title || "",
      feedback: edit?.feedback || draft?.feedback || "",
      nextAction: edit?.nextAction || draft?.nextAction || "",
      reminder: edit?.reminder || draft?.reminder || "both",
    },
    revision: edit?.revision,
  });
  const saved = useRef(readLocal<StoredDraft>(key));
  const [form, setForm] = useState<StoredDraft>(() =>
    saved.current?.input ? saved.current : original(),
  );
  const [at, setAt] = useState(
    () => form.wallTime ?? beijingInput(form.input.at),
  );
  const dirty = useRef(Boolean(saved.current));
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [done, setDone] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const prefix = useId();
  const mutation = useCustomerMutation(api, mode, `form-${scope}`);
  const customers = useCustomerQuery<Customer[]>(
    api,
    "customers.list",
    {},
    version,
  );
  const latest = useCustomerQuery<CustomerTask | Customer[]>(
    api,
    edit ? "tasks.get" : "customers.list",
    edit ? { id: edit.id } : {},
    version,
    refresh,
  );
  useEffect(() => {
    if (
      !edit ||
      !latest.data ||
      Array.isArray(latest.data) ||
      dirty.current ||
      mutation.hasPending
    )
      return;
    const t = latest.data;
    setForm({
      input: {
        customerId: t.customerId,
        at: t.at,
        title: t.title,
        feedback: t.feedback,
        nextAction: t.nextAction,
        reminder: t.reminder,
      },
      revision: t.revision,
    });
    setAt(beijingInput(t.at));
  }, [latest.data, edit, mutation.hasPending]);
  useEffect(() => {
    if (done) return;
    try {
      writeLocal(key, { ...form, wallTime: at });
      setStorageError("");
    } catch (e) {
      setStorageError(message(e));
    }
  }, [key, form, at, done]);
  function change<K extends keyof TaskInput>(field: K, value: TaskInput[K]) {
    dirty.current = true;
    setForm((f) => ({ ...f, input: { ...f.input, [field]: value } }));
  }
  async function save(submittedAt = at) {
    setError("");
    // Read the actual control at submit time as well as React state. This also
    // protects a native datetime picker whose last input event has not flushed.
    if (!mutation.hasPending && submittedAt !== at) {
      dirty.current = true;
      setAt(submittedAt);
    }
    let input: TaskInput;
    try {
      input = {
        ...form.input,
        at: beijingToUTC(submittedAt),
        title: form.input.title.trim(),
      };
      if (!input.customerId || !input.title)
        throw new Error("请选择客户并填写日程标题");
      writeLocal(key, { ...form, input, wallTime: submittedAt });
    } catch (e) {
      setError(message(e));
      return;
    }
    const ok = await mutation.run(
      edit ? "tasks.update" : "tasks.create",
      edit
        ? { id: edit.id, revision: form.revision, task: input }
        : { task: input },
    );
    if (ok) {
      setDone(true);
      removeLocal(key);
      onSaved(edit ? "日程已更新" : "日程已添加");
    } else if (edit) setRefresh((v) => v + 1);
  }
  const active = customers.data?.filter((c) => !c.mergedInto) || [];
  const stale =
    edit &&
    latest.data &&
    !Array.isArray(latest.data) &&
    latest.data.revision !== form.revision;
  return (
    <form
      className="customer-ui customer-task-form"
      onSubmit={(e) => {
        e.preventDefault();
        const value = new FormData(e.currentTarget).get("beijing-at");
        void save(typeof value === "string" ? value : at);
      }}
    >
      <p className="subtle">
        时间统一按北京时间。下一次跟进须点击保存后才会创建。
      </p>
      {customers.error && <ErrorNote>{customers.error}</ErrorNote>}
      {edit && latest.error && <ErrorNote>{latest.error}</ErrorNote>}
      {stale && (
        <div className="customer-pending">
          <ErrorNote>这条日程已有新版本，你的输入仍保留。</ErrorNote>
          <p>最新标题：{(latest.data as CustomerTask).title}</p>
          <p className="customer-task-text">
            最新反馈：{(latest.data as CustomerTask).feedback || "无"}
            <br />
            最新下一步：{(latest.data as CustomerTask).nextAction || "无"}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={mutation.hasPending || mutation.busy}
            onClick={() =>
              setForm((f) => ({
                ...f,
                revision: (latest.data as CustomerTask).revision,
              }))
            }
          >
            已核对最新记录，保留我的输入继续编辑
          </button>
        </div>
      )}
      {storageError && <ErrorNote>{storageError}</ErrorNote>}
      {(error || mutation.error) && (
        <ErrorNote>{error || mutation.error}</ErrorNote>
      )}
      <fieldset disabled={mutation.busy || mutation.hasPending || done}>
        <label htmlFor={`${prefix}-customer`}>客户</label>
        <select
          id={`${prefix}-customer`}
          value={form.input.customerId}
          required
          onChange={(e) => change("customerId", e.target.value)}
        >
          <option value="">选择客户</option>
          {form.input.customerId &&
            !active.some((c) => c.id === form.input.customerId) && (
              <option value={form.input.customerId}>
                {edit ? "当前客户" : "所选客户"}
              </option>
            )}
          {active.map((c) => (
            <option key={c.id} value={c.id}>
              {displayCustomerName(c.name)}
            </option>
          ))}
        </select>
        <label htmlFor={`${prefix}-at`}>
          跟进时间 <small>北京时间 UTC+8</small>
        </label>
        <input
          id={`${prefix}-at`}
          name="beijing-at"
          type="datetime-local"
          required
          value={at}
          onInput={(e) => {
            dirty.current = true;
            setAt(e.currentTarget.value);
          }}
          onChange={(e) => {
            dirty.current = true;
            setAt(e.target.value);
          }}
        />
        <label htmlFor={`${prefix}-title`}>要做什么</label>
        <input
          id={`${prefix}-title`}
          required
          maxLength={200}
          value={form.input.title}
          placeholder="例如：确认续费意向"
          onChange={(e) => change("title", e.target.value)}
        />
        <label htmlFor={`${prefix}-feedback`}>本次反馈</label>
        <textarea
          id={`${prefix}-feedback`}
          rows={3}
          maxLength={2000}
          value={form.input.feedback}
          placeholder="记下客户的想法和沟通结果"
          onChange={(e) => change("feedback", e.target.value)}
        />
        <label htmlFor={`${prefix}-next`}>下一步</label>
        <textarea
          id={`${prefix}-next`}
          rows={2}
          maxLength={2000}
          value={form.input.nextAction}
          placeholder="下一次准备跟进什么"
          onChange={(e) => change("nextAction", e.target.value)}
        />
        <label htmlFor={`${prefix}-reminder`}>提醒</label>
        <select
          id={`${prefix}-reminder`}
          value={form.input.reminder}
          onChange={(e) =>
            change("reminder", e.target.value as TaskInput["reminder"])
          }
        >
          <option value="both">提前提醒 + 到时提醒</option>
          <option value="due">仅到时提醒</option>
          <option value="off">关闭提醒</option>
        </select>
      </fieldset>
      <p className="customer-draft-note" role="status">
        {mutation.hasPending
          ? "未保存 · 保存结果待确认，请重试原请求；输入已保留。"
          : storageError
            ? "未保存 · 草稿暂未写入本机，请保持页面打开。"
            : "未保存 · 草稿已保留在本机，关闭后可继续填写。"}
      </p>
      <div className="customer-actions">
        <button
          type="button"
          className="button secondary"
          disabled={mutation.busy}
          onClick={onCancel}
        >
          关闭
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={
            mutation.busy || done || Boolean(stale && !mutation.hasPending)
          }
        >
          <Save size={16} />
          {mutation.busy
            ? "保存中…"
            : mutation.hasPending
              ? "重试保存"
              : "保存日程"}
        </button>
      </div>
    </form>
  );
}

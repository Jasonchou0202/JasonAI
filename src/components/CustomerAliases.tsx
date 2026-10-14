import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, GitMerge, RotateCcw } from "lucide-react";
import type {
  Api,
  CustomerSuggestionGroup,
  CustomerTask,
} from "../domain/model";
import { money } from "../domain/finance";
import { displayCustomerName } from "../domain/customers";
import {
  apiMode,
  beijingInput,
  useCustomerMutation,
  useCustomerQuery,
  type Customer,
  type CustomerDetail,
} from "../lib/customer-ui";
import { Empty, ErrorNote, Loading } from "./ui";
import "../customer.css";

export function CustomerAliases({
  api,
  version,
  onChange,
}: {
  api: Api;
  version: number;
  onChange: (msg: string) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [allPreview, setAllPreview] = useState(false);
  const [onlyIp, setOnlyIp] = useState(false);
  const [allBusy, setAllBusy] = useState(false);
  const batchLock = useRef(false);
  const prefix = useId();
  const customers = useCustomerQuery<Customer[]>(
    api,
    "customers.list",
    {},
    version,
    refresh,
  );
  const mutation = useCustomerMutation(api, apiMode(api), "aliases");
  const suggestMutation = useCustomerMutation(api, apiMode(api), "suggestions");
  const suggestions = useCustomerQuery<CustomerSuggestionGroup[]>(
    api,
    "customers.suggestions",
    {},
    version,
    refresh,
  );
  const active = customers.data?.filter((c) => !c.mergedInto) || [];
  const previewGroups = (suggestions.data || []).filter(
    (group) => !onlyIp || group.reason === "ip_or_symbol",
  );
  const query = search.trim().toLocaleLowerCase();
  const merged =
    customers.data?.filter(
      (c) =>
        c.mergedInto &&
        (!query ||
          [c.name, customers.data?.find((t) => t.id === c.mergedInto)?.name]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query)),
    ) || [];
  useEffect(() => {
    setPreview(false);
    setConfirmed(false);
  }, [sourceId, targetId, version]);
  function changed(msg: string) {
    setRefresh((v) => v + 1);
    onChange(msg);
  }
  function groupSources(group: CustomerSuggestionGroup) {
    return group.members
      .filter((m) => m.customer.id !== group.targetId)
      .map((m) => ({ id: m.customer.id, revision: m.customer.revision }));
  }
  async function mergeGroup(group: CustomerSuggestionGroup) {
    const sources = groupSources(group);
    if (!sources.length) return;
    if (
      await suggestMutation.run("customers.mergeMany", {
        targetId: group.targetId,
        sources,
      })
    )
      changed(`已把 ${group.members.length} 个名称合并为一个客户`);
  }
  async function mergeAll() {
    if (batchLock.current) return;
    batchLock.current = true;
    setAllBusy(true);
    const groups = previewGroups;
    let merged = 0;
    try {
      for (const group of groups) {
        const sources = groupSources(group);
        if (!sources.length) continue;
        if (
          !(await suggestMutation.run("customers.mergeMany", {
            targetId: group.targetId,
            sources,
          }))
        )
          return;
        merged++;
      }
    } finally {
      batchLock.current = false;
      setAllBusy(false);
      setAllPreview(false);
      if (merged) changed(`已合并 ${merged} 组建议名称，剩余建议可继续处理`);
    }
  }
  async function unmerge(customer: Customer) {
    if (
      await mutation.run("customers.unmerge", {
        id: customer.id,
        revision: customer.revision,
      })
    )
      changed("客户名称已解除合并");
  }
  const source = active.find((c) => c.id === sourceId);
  const target = active.find((c) => c.id === targetId);
  return (
    <section className="panel customer-ui customer-aliases">
      <div className="panel-heading">
        <div>
          <h2>
            <GitMerge size={17} /> 客户名称与别名
          </h2>
          <p>同一位客户的不同名称，可以合并管理。</p>
        </div>
      </div>
      <div className="customer-pad">
        {customers.error && (
          <>
            <ErrorNote>{customers.error}</ErrorNote>
            <button
              className="text-button"
              onClick={() => setRefresh((v) => v + 1)}
            >
              重新读取客户
            </button>
          </>
        )}
        {customers.loading && <Loading />}
        {mutation.error && <ErrorNote>{mutation.error}</ErrorNote>}
        {mutation.hasPending && (
          <div className="customer-pending">
            <p>上一次操作结果尚未确认，请先重试原请求。</p>
            <button
              className="button secondary"
              disabled={mutation.busy}
              onClick={async () => {
                const p = mutation.pending;
                if (p && (await mutation.run(p.action, p.payload))) {
                  setPreview(false);
                  changed("客户名称操作已确认");
                }
              }}
            >
              重试上次操作
            </button>
          </div>
        )}
        <div className="customer-merge-selectors">
          <div>
            <label htmlFor={`${prefix}-source`}>要合并的名称</label>
            <select
              id={`${prefix}-source`}
              value={sourceId}
              disabled={mutation.busy || mutation.hasPending}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="">选择来源客户</option>
              {active
                .filter((c) => c.id !== targetId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {displayCustomerName(c.name)}
                  </option>
                ))}
            </select>
          </div>
          <ArrowRight size={18} className="customer-merge-arrow" />
          <div>
            <label htmlFor={`${prefix}-target`}>统一归属到</label>
            <select
              id={`${prefix}-target`}
              value={targetId}
              disabled={mutation.busy || mutation.hasPending}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">选择目标客户</option>
              {active
                .filter((c) => c.id !== sourceId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {displayCustomerName(c.name)}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <button
          className="button secondary customer-preview-button"
          disabled={
            !source ||
            !target ||
            sourceId === targetId ||
            mutation.busy ||
            mutation.hasPending
          }
          onClick={() => {
            setPreview(true);
            setConfirmed(false);
          }}
        >
          查看全历史合并预览
        </button>
        {preview && source && target && (
          <MergePreview
            key={`${source.id}:${target.id}:${version}:${refresh}`}
            api={api}
            version={version}
            source={source}
            target={target}
            busy={mutation.busy || mutation.hasPending}
            confirmed={confirmed}
            onConfirmed={setConfirmed}
            onMerge={async (revision) => {
              if (
                await mutation.run("customers.merge", {
                  sourceId,
                  targetId,
                  revision,
                })
              ) {
                setSourceId("");
                setTargetId("");
                setPreview(false);
                changed("客户名称已合并");
              }
            }}
          />
        )}
        {!customers.loading && customers.data?.length === 0 && (
          <Empty title="还没有客户名称">
            填写销售客户后，名称会出现在这里。
          </Empty>
        )}
        {suggestions.error && <ErrorNote>{suggestions.error}</ErrorNote>}
        {(!!suggestions.data?.length || suggestMutation.hasPending) && (
          <div className="customer-suggestions">
            <div className="customer-suggestions-head">
              <h3>疑似同一客户（建议合并）</h3>
              <button
                className="button secondary"
                disabled={
                  allBusy || suggestMutation.busy || suggestMutation.hasPending
                }
                onClick={() => {
                  setOnlyIp(false);
                  setAllPreview(true);
                }}
              >
                全部合并
              </button>
              {suggestions.data?.some(
                (group) => group.reason === "ip_or_symbol",
              ) && (
                <button
                  className="button secondary"
                  disabled={
                    allBusy ||
                    suggestMutation.busy ||
                    suggestMutation.hasPending
                  }
                  onClick={() => {
                    setOnlyIp(true);
                    setAllPreview(true);
                  }}
                >
                  仅合并 IP/符号变体
                </button>
              )}
            </div>
            {allPreview && (
              <div className="customer-pending">
                <p>
                  请核对下方 {previewGroups.length} 组建议，
                  {onlyIp
                    ? "此次仅合并 IP 或符号变体，大小写建议保持不变。"
                    : "此次包含仅大小写不同的名称。"}
                  每组将归属到推荐客户，合并后可解除。
                </p>
                <button
                  className="button primary"
                  disabled={allBusy || !previewGroups.length}
                  onClick={() => void mergeAll()}
                >
                  {allBusy
                    ? "合并中…"
                    : onlyIp
                      ? "已预览，确认合并 IP/符号变体"
                      : "已预览，确认全部合并"}
                </button>
                <button
                  className="text-button"
                  disabled={allBusy}
                  onClick={() => setAllPreview(false)}
                >
                  取消
                </button>
              </div>
            )}
            {suggestMutation.error && (
              <ErrorNote>{suggestMutation.error}</ErrorNote>
            )}
            {suggestMutation.hasPending && (
              <div className="customer-pending">
                <p>上次合并结果待确认，请先重试原请求。</p>
                <button
                  className="button secondary"
                  disabled={suggestMutation.busy || allBusy}
                  onClick={async () => {
                    const pending = suggestMutation.pending;
                    if (
                      pending &&
                      (await suggestMutation.run(
                        pending.action,
                        pending.payload,
                      ))
                    )
                      changed("上次合并已确认");
                  }}
                >
                  重试上次合并
                </button>
              </div>
            )}
            {suggestions.data?.map((group) => {
              const target = group.members.find(
                (m) => m.customer.id === group.targetId,
              )!;
              return (
                <div className="suggestion-card" key={group.id}>
                  <div className="suggestion-head">
                    <strong>
                      {group.reason === "ip_or_symbol"
                        ? "IP 或符号变体"
                        : "仅大小写不同"}
                    </strong>
                    <span className="subtle">
                      {group.members.length} 个名称
                    </span>
                  </div>
                  <div className="suggestion-members">
                    {group.members.map((m) => (
                      <span key={m.customer.id}>
                        {displayCustomerName(m.customer.name)}
                        <small>
                          {m.totals.count} 笔 · 利润 ¥{money(m.totals.profit)} ·{" "}
                          {m.taskCount} 日程
                        </small>
                      </span>
                    ))}
                  </div>
                  <p className="subtle">
                    合计 {group.totals.count} 笔 · 利润 ¥
                    {money(group.totals.profit)} · {group.taskCount}{" "}
                    条日程；归属到「{displayCustomerName(target.customer.name)}
                    」。
                  </p>
                  <SuggestionDetails
                    api={api}
                    group={group}
                    version={version + refresh}
                  />
                  <button
                    className="button primary"
                    disabled={
                      allBusy ||
                      suggestMutation.busy ||
                      suggestMutation.hasPending
                    }
                    onClick={() => void mergeGroup(group)}
                  >
                    一键合并
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="customer-alias-divider">
          <h3>已合并名称</h3>
          <input
            type="search"
            aria-label="搜索已合并名称"
            placeholder="搜索来源或归属客户"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {merged.length ? (
          <ul className="customer-alias-list">
            {merged.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{displayCustomerName(c.name)}</strong>
                  <small>
                    归属：
                    {displayCustomerName(
                      customers.data?.find((t) => t.id === c.mergedInto)
                        ?.name ||
                        c.mergedInto ||
                        "",
                    )}
                  </small>
                </div>
                <button
                  className="text-button"
                  disabled={mutation.busy || mutation.hasPending}
                  onClick={() => void unmerge(c)}
                >
                  <RotateCcw size={15} />
                  解除合并
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !customers.loading &&
          !customers.error && (
            <p className="subtle">
              {query ? "没有符合条件的已合并名称。" : "暂无已合并名称。"}
            </p>
          )
        )}
      </div>
    </section>
  );
}
function SuggestionDetails({
  api,
  group,
  version,
}: {
  api: Api;
  group: CustomerSuggestionGroup;
  version: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>展开销售与日程明细</summary>
      {open &&
        group.members.map((member) => (
          <SuggestionMemberDetails
            key={member.customer.id}
            api={api}
            id={member.customer.id}
            version={version}
          />
        ))}
    </details>
  );
}
function SuggestionMemberDetails({
  api,
  id,
  version,
}: {
  api: Api;
  id: string;
  version: number;
}) {
  const sales = useCustomerQuery<CustomerDetail>(
    api,
    "customers.detail",
    { id, month: "all" },
    version,
  );
  const tasks = useCustomerQuery<CustomerTask[]>(
    api,
    "tasks.list",
    { customerId: id },
    version,
  );
  return (
    <div className="customer-merge-preview">
      {(sales.loading || tasks.loading) && <Loading />}
      {(sales.error || tasks.error) && (
        <ErrorNote>{sales.error || tasks.error}</ErrorNote>
      )}
      {sales.data && (
        <>
          <strong>
            {displayCustomerName(sales.data.customer.name)} · 档案{" "}
            {id.slice(-6)}
          </strong>
          <ul>
            {sales.data.sales.map((sale) => (
              <li key={sale.id}>
                {sale.date} · {sale.productName} · 利润 ¥
                {money(sale.revenue - sale.cost)}
              </li>
            ))}
          </ul>
        </>
      )}
      <ul>
        {tasks.data?.map((task) => (
          <li key={task.id}>
            {beijingInput(task.at).replace("T", " ")}（北京时间） · {task.title}{" "}
            · {task.completedAt ? "已完成" : "未完成"}
          </li>
        ))}
      </ul>
    </div>
  );
}
function MergePreview({
  api,
  version,
  source,
  target,
  busy,
  confirmed,
  onConfirmed,
  onMerge,
}: {
  api: Api;
  version: number;
  source: Customer;
  target: Customer;
  busy: boolean;
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
  onMerge: (revision: number) => Promise<void>;
}) {
  const [retry, setRetry] = useState(0);
  const left = useCustomerQuery<CustomerDetail>(
    api,
    "customers.detail",
    { id: source.id, month: "all" },
    version,
    retry,
  );
  const right = useCustomerQuery<CustomerDetail>(
    api,
    "customers.detail",
    { id: target.id, month: "all" },
    version,
    retry,
  );
  const leftTasks = useCustomerQuery<CustomerTask[]>(
    api,
    "tasks.list",
    { customerId: source.id },
    version,
    retry,
  );
  const rightTasks = useCustomerQuery<CustomerTask[]>(
    api,
    "tasks.list",
    { customerId: target.id },
    version,
    retry,
  );
  const ready = Boolean(
    left.data &&
    right.data &&
    !left.loading &&
    !right.loading &&
    !left.error &&
    !right.error &&
    leftTasks.data &&
    rightTasks.data &&
    !leftTasks.loading &&
    !rightTasks.loading &&
    !leftTasks.error &&
    !rightTasks.error &&
    left.data.customer.id === source.id &&
    right.data.customer.id === target.id &&
    !left.data.customer.mergedInto &&
    !right.data.customer.mergedInto,
  );
  return (
    <div className="customer-merge-preview">
      <h3>合并前 · 全历史销售</h3>
      {(leftTasks.error || rightTasks.error) && (
        <ErrorNote>{leftTasks.error || rightTasks.error}</ErrorNote>
      )}
      {(left.loading || right.loading) && <Loading />}
      {(left.error || right.error) && (
        <>
          <ErrorNote>{left.error || right.error}</ErrorNote>
          <button
            className="text-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            重新读取全历史数据
          </button>
        </>
      )}
      {!left.loading && !right.loading && left.data && right.data && !ready && (
        <ErrorNote>
          客户归属已发生变化，请重新读取客户并选择合并对象。
        </ErrorNote>
      )}
      <div className="customer-merge-totals">
        {[left.data, right.data].map((detail, i) => (
          <div key={i}>
            <small>{i === 0 ? "来源客户" : "目标客户"}</small>
            <strong>
              {displayCustomerName(i === 0 ? source.name : target.name)}
            </strong>
            <span>{detail ? `${detail.totals.count} 笔成交` : "正在核对"}</span>
            <span>利润 {detail ? `¥${money(detail.totals.profit)}` : "—"}</span>
            <span>
              {(i === 0 ? leftTasks.data : rightTasks.data)?.length ?? "—"}{" "}
              条日程
            </span>
            {(i === 0 ? leftTasks.data : rightTasks.data)
              ?.slice(0, 3)
              .map((task) => (
                <small key={task.id}>
                  {task.title}
                  {task.completedAt ? " · 已完成" : " · 未完成"}
                </small>
              ))}
          </div>
        ))}
      </div>
      {ready && (
        <p className="customer-merge-result">
          合并后归属「{displayCustomerName(target.name)}」：共{" "}
          {left.data!.totals.count + right.data!.totals.count} 笔，利润 ¥
          {money(left.data!.totals.profit + right.data!.totals.profit)}。
        </p>
      )}
      <p className="subtle">
        来源名称会成为目标客户的别名。确认两者为同一客户后再合并；可在已合并名称中解除。
      </p>
      <label className="customer-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy || !ready}
          onChange={(e) => onConfirmed(e.target.checked)}
        />
        这两个名称属于同一位客户
      </label>
      <button
        className="button primary"
        disabled={!ready || !confirmed || busy}
        onClick={() => void onMerge(left.data!.customer.revision)}
      >
        <GitMerge size={16} />
        {busy ? "合并中…" : "确认合并"}
      </button>
    </div>
  );
}

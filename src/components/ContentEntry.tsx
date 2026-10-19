import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileCheck2,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  CONTENT_SOURCES,
  NOTE_MAX,
  contentAddDays,
  contentToday,
  contentValidDate,
  validateDailyInput,
  type ContentDaily,
  type ContentSource,
  type PublishableExport,
} from "../domain/content";
import type { ContentApi } from "../lib/content-api";
import { ErrorNote, message } from "./ui";
import "../content-entry.css";

type Draft = {
  date: string;
  wechat_adds: string;
  leads: Record<ContentSource, string>;
  note: string;
  requestId: string;
};
const emptyLeads = () =>
  Object.fromEntries(CONTENT_SOURCES.map((k) => [k, ""])) as Record<
    ContentSource,
    string
  >;
const fresh = (date: string): Draft => ({
  date,
  wechat_adds: "",
  leads: emptyLeads(),
  note: "",
  requestId: crypto.randomUUID(),
});
const fromRow = (r: ContentDaily): Draft => ({
  date: r.date,
  wechat_adds: String(r.wechat_adds),
  leads: Object.fromEntries(
    CONTENT_SOURCES.map((k) => [k, String(r.leads[k])]),
  ) as Record<ContentSource, string>,
  note: r.note,
  requestId: crypto.randomUUID(),
});
/** 输入框里的文字转成整数；空着算 0，乱填返回 NaN 让校验报错 */
function num(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}
function label(date: string) {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
}
function exportName(x: PublishableExport) {
  return `内容获客汇总-${x.from}至${x.to}.json`;
}

export function ContentEntry({
  api,
  mode,
  onSaved,
}: {
  api: ContentApi;
  mode: string;
  onSaved: (text: string) => void;
}) {
  const draftKey = `zhangyuge-content-draft-${mode}`;
  const [initial] = useState<{ form: Draft; dirty: boolean }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (saved && contentValidDate(saved.date) && saved.leads)
        return { form: saved, dirty: true };
    } catch {}
    return { form: fresh(contentToday()), dirty: false };
  });
  const [form, setForm] = useState<Draft>(initial.form);
  const [dirty, setDirty] = useState(initial.dirty);
  const [record, setRecord] = useState<ContentDaily | null>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [recent, setRecent] = useState<ContentDaily[]>();
  const [deleted, setDeleted] = useState<ContentDaily[]>([]);
  const [listError, setListError] = useState("");
  const [confirming, setConfirming] = useState("");
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  // 读这一天云端已有的记录；本机有没保存的草稿时保留草稿
  useEffect(() => {
    let current = true;
    setRecord(undefined);
    api
      .call<ContentDaily | null>("content.daily.get", { date: form.date })
      .then((r) => {
        if (!current) return;
        setRecord(r);
        if (!dirty) setForm(r && !r.deletedAt ? fromRow(r) : fresh(form.date));
      })
      .catch((e) => current && setError(message(e)));
    return () => {
      current = false;
    };
    // dirty 只在切换日期时参考，不作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, form.date, version]);
  useEffect(() => {
    let current = true;
    const to = contentToday();
    const from = contentAddDays(to, -13);
    setListError("");
    Promise.all([
      api.call<ContentDaily[]>("content.daily.list", { from, to }),
      api.call<ContentDaily[]>("content.daily.list", {
        from: contentAddDays(to, -59),
        to,
        deleted: true,
      }),
    ])
      .then(([rows, gone]) => {
        if (!current) return;
        setRecent([...rows].reverse());
        setDeleted([...gone].reverse());
      })
      .catch((e) => current && setListError(message(e)));
    return () => {
      current = false;
    };
  }, [api, version]);
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(draftKey, JSON.stringify(form));
      else localStorage.removeItem(draftKey);
    } catch {}
  }, [form, dirty, draftKey]);

  const total = num(form.wechat_adds);
  const sum = CONTENT_SOURCES.reduce((s, k) => s + num(form.leads[k]), 0);
  const balanced =
    form.wechat_adds.trim() !== "" && !Number.isNaN(sum) && sum === total;
  const activeRow = record && !record.deletedAt ? record : null;

  function edit(patch: Partial<Draft>) {
    setDirty(true);
    setError("");
    setForm((f) => ({ ...f, ...patch }));
  }
  function pickDate(date: string) {
    if (!contentValidDate(date)) return;
    setDirty(false);
    setError("");
    setConfirming("");
    setForm(fresh(date));
  }
  async function run(work: () => Promise<string>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const text = await work();
      if (alive.current) {
        setDirty(false);
        setConfirming("");
        setVersion((v) => v + 1);
        onSaved(text);
      }
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function save() {
    void run(async () => {
      const input = validateDailyInput({
        date: form.date,
        wechat_adds: num(form.wechat_adds),
        leads: Object.fromEntries(
          CONTENT_SOURCES.map((k) => [k, num(form.leads[k])]),
        ),
        note: form.note,
      });
      await api.call("content.daily.save", {
        ...input,
        requestId: form.requestId,
        revision: activeRow?.revision,
      });
      return `${label(input.date)}的获客已保存`;
    });
  }
  function remove(row: ContentDaily) {
    void run(async () => {
      await api.call("content.daily.delete", {
        date: row.date,
        revision: row.revision,
        requestId: crypto.randomUUID(),
      });
      return `${label(row.date)}的记录已删除，可在下方恢复`;
    });
  }
  function restore(row: ContentDaily) {
    void run(async () => {
      await api.call("content.daily.restore", {
        date: row.date,
        revision: row.revision,
        requestId: crypto.randomUUID(),
      });
      return `${label(row.date)}的记录已恢复`;
    });
  }

  return (
    <div className="content-entry">
      <div className="page-heading">
        <div>
          <span className="eyebrow">内容生产板块</span>
          <h1>今日获客录入</h1>
          <p className="subtle">
            每晚记一次：当天新增微信好友，以及来自哪个平台。
          </p>
        </div>
        <span className="draft-state">
          {dirty
            ? "未保存 · 草稿已保留在本机"
            : activeRow
              ? `${label(form.date)}已录入 · 第 ${activeRow.revision} 版`
              : record?.deletedAt
                ? `${label(form.date)}的记录已删除，可在下方恢复`
                : `${label(form.date)}还没有录入`}
        </span>
      </div>
      <div className="entry-layout">
        <form
          className="panel entry-form"
          aria-label="获客录入"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <section>
            <div className="form-section-title">
              <span>01</span>
              <h2>哪一天，加了多少人</h2>
            </div>
            <div className="field-grid">
              <div>
                <label htmlFor="content-date">
                  日期<span className="required">*</span>
                </label>
                <input
                  id="content-date"
                  type="date"
                  value={form.date}
                  max={contentToday()}
                  min="2020-01-01"
                  required
                  onChange={(e) => pickDate(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="content-adds">
                  当天新增微信好友<span className="required">*</span>
                </label>
                <input
                  id="content-adds"
                  className="content-number"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0"
                  value={form.wechat_adds}
                  onChange={(e) => edit({ wechat_adds: e.target.value })}
                />
              </div>
            </div>
          </section>
          <section>
            <div className="form-section-title">
              <span>02</span>
              <h2>来自哪里</h2>
            </div>
            <div className="content-sources">
              {CONTENT_SOURCES.map((k) => (
                <div key={k}>
                  <label htmlFor={`content-src-${k}`}>{k}</label>
                  <input
                    id={`content-src-${k}`}
                    className="content-number"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0"
                    value={form.leads[k]}
                    onChange={(e) =>
                      edit({ leads: { ...form.leads, [k]: e.target.value } })
                    }
                  />
                </div>
              ))}
            </div>
            <p
              className={`content-balance ${balanced ? "ok" : "off"}`}
              aria-live="polite"
            >
              {Number.isNaN(sum) || Number.isNaN(total)
                ? "人数只能填 0 或正整数"
                : balanced
                  ? `四个来源合计 ${sum} 人，和新增人数一致`
                  : `四个来源合计 ${sum} 人，新增 ${form.wechat_adds.trim() ? total : "—"} 人，还差 ${Number.isNaN(total) ? "—" : Math.abs(total - sum)} 人对不上`}
            </p>
          </section>
          <section>
            <label htmlFor="content-note">
              备注 <small>选填，只写来源情况，不写人</small>
            </label>
            <textarea
              id="content-note"
              rows={2}
              maxLength={NOTE_MAX}
              value={form.note}
              placeholder="例如：抖音第 88 集带来的比较多"
              onChange={(e) => edit({ note: e.target.value })}
            />
          </section>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="form-actions">
            <button type="submit" className="button primary" disabled={busy}>
              <Check size={17} />
              {busy ? "正在保存…" : activeRow ? "保存修改" : "保存这一天"}
            </button>
            {activeRow && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setDirty(false);
                  setForm(fromRow(activeRow));
                }}
              >
                <RotateCcw size={16} />
                撤销改动
              </button>
            )}
          </div>
        </form>
        <aside className="entry-aside" aria-label="录入说明">
          <div className="paper-slip content-slip">
            <span className="eyebrow">{label(form.date)} · 获客小票</span>
            <div className="slip-rule" />
            {CONTENT_SOURCES.map((k) => (
              <div key={k}>
                <span>{k}</span>
                <strong>{num(form.leads[k]) || 0}</strong>
              </div>
            ))}
            <div className="slip-total">
              <span>新增微信好友</span>
              <strong>{Number.isNaN(total) ? "—" : total}</strong>
            </div>
          </div>
          <div className="entry-tip">
            <ShieldCheck size={18} />
            <p>
              每日明细只存在私人云端，看板不会直接读取。
              <br />
              要公开时，用下方「生成可发布汇总」，确认后再交给第二大脑发布。
            </p>
          </div>
        </aside>
      </div>

      <section
        className="panel content-recent"
        aria-labelledby="content-recent-title"
      >
        <h2 id="content-recent-title">最近 14 天</h2>
        {listError && <ErrorNote>{listError}</ErrorNote>}
        {recent && recent.length === 0 && (
          <p className="subtle">最近 14 天还没有录入。</p>
        )}
        {recent && recent.length > 0 && (
          <div className="content-table-wrap">
            <table className="content-table">
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  <th scope="col">新增</th>
                  {CONTENT_SOURCES.map((k) => (
                    <th scope="col" key={k}>
                      {k}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr
                    key={r.date}
                    className={r.date === form.date ? "current" : ""}
                  >
                    <th scope="row">{label(r.date)}</th>
                    <td>{r.wechat_adds}</td>
                    {CONTENT_SOURCES.map((k) => (
                      <td key={k}>{r.leads[k]}</td>
                    ))}
                    <td className="content-row-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => pickDate(r.date)}
                        aria-label={`修改${label(r.date)}`}
                      >
                        修改
                      </button>
                      {confirming === r.date ? (
                        <button
                          type="button"
                          className="text-button danger-text"
                          disabled={busy}
                          onClick={() => remove(r)}
                        >
                          确认删除
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`删除${label(r.date)}`}
                          onClick={() => setConfirming(r.date)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          删除
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {deleted.length > 0 && (
          <div className="content-deleted">
            <h3>最近删除</h3>
            <ul>
              {deleted.map((r) => (
                <li key={r.date}>
                  <span>
                    {label(r.date)} · {r.wechat_adds} 人
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    aria-label={`恢复${label(r.date)}`}
                    onClick={() => restore(r)}
                  >
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <PublishPanel api={api} />
      <BackupPanel api={api} />
    </div>
  );
}

function PublishPanel({ api }: { api: ContentApi }) {
  const today = contentToday();
  const [from, setFrom] = useState(contentAddDays(today, -6));
  const [to, setTo] = useState(today);
  const [result, setResult] = useState<PublishableExport>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = useMemo(
    () => (result ? JSON.stringify(result, null, 2) : ""),
    [result],
  );
  async function generate() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      setResult(
        await api.call<PublishableExport>("content.export.publishable", {
          from,
          to,
        }),
      );
    } catch (e) {
      setResult(undefined);
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!result) return;
    saveFile(exportName(result), text);
  }
  return (
    <section
      className="panel content-publish"
      aria-labelledby="content-publish-title"
    >
      <h2 id="content-publish-title">生成可发布汇总</h2>
      <p className="subtle">
        只包含日期、当天新增人数和四个来源的人数，不含备注。公开看板会永久保留这些数字，确认没问题再交给第二大脑。
      </p>
      <div className="content-publish-range">
        <div>
          <label htmlFor="publish-from">开始日期</label>
          <input
            id="publish-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setResult(undefined);
            }}
          />
        </div>
        <div>
          <label htmlFor="publish-to">结束日期</label>
          <input
            id="publish-to"
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => {
              setTo(e.target.value);
              setResult(undefined);
            }}
          />
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={busy || !contentValidDate(from) || !contentValidDate(to)}
          onClick={() => void generate()}
        >
          <FileCheck2 size={16} />
          {busy ? "正在生成…" : "生成可发布汇总"}
        </button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {result && (
        <div className="content-publish-result">
          <p role="status">
            {result.from} 至 {result.to}：共 {result.daily.length}{" "}
            天有记录，合计 {result.daily.reduce((s, d) => s + d.wechat_adds, 0)}{" "}
            人{result.daily.length === 0 ? "（没有可发布的数字）" : ""}
          </p>
          <textarea
            readOnly
            aria-label="可发布汇总内容"
            rows={8}
            value={text}
          />
          <div className="form-actions">
            <button type="button" className="button primary" onClick={download}>
              <Download size={16} />
              下载汇总文件
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(text)
                  .then(() => setCopied(true))
                  .catch(() => setError("浏览器没有允许复制，请改用下载"));
              }}
            >
              <Copy size={16} />
              {copied ? "已复制" : "复制内容"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BackupPanel({ api }: { api: ContentApi }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section
      className="panel content-publish"
      aria-labelledby="content-backup-title"
    >
      <h2 id="content-backup-title">内容数据备份</h2>
      <p className="subtle">
        下载全部每日记录（含已删除的）和修改记录，只在本机保存，不要发到公开的地方。和销售账本的备份分开。
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            api
              .call("content.backup")
              .then((b) =>
                saveFile(
                  `内容数据备份-${contentToday()}.json`,
                  JSON.stringify(b, null, 2),
                ),
              )
              .catch((e) => setError(message(e)))
              .finally(() => setBusy(false));
          }}
        >
          <Download size={16} />
          {busy ? "正在准备…" : "下载内容数据备份"}
        </button>
      </div>
    </section>
  );
}

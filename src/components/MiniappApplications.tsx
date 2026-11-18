import { useEffect, useState } from "react";
import { useTeam } from "../lib/team-ui";
import {
  probeMiniapp,
  bjDateText,
  formatAdminPhone,
  type MiniappApi,
  type MiniappApplication,
  type MiniappApplicationList,
  type MiniappProbe,
} from "../lib/miniapp-api";
import { ErrorNote, Loading, message } from "./ui";
import "../miniapp.css";

export function MiniappApplications() {
  const { me } = useTeam();
  const [probe, setProbe] = useState<MiniappProbe>({ status: "pending" });
  useEffect(() => {
    if (me.role !== "admin") {
      setProbe({ status: "hidden" });
      return;
    }
    let alive = true;
    void probeMiniapp().then((r) => {
      if (alive) setProbe(r);
    });
    return () => {
      alive = false;
    };
  }, [me.role]);
  if (me.role !== "admin" || probe.status === "hidden" || probe.status === "pending") return null;
  return <ApplicationPanels api={probe.api} />;
}

function ApplicationPanels({ api }: { api: MiniappApi }) {
  const [data, setData] = useState<MiniappApplicationList>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [linkFor, setLinkFor] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void api
      .call<MiniappApplicationList>("miniapp.apply.list")
      .then((rows) => {
        if (alive) setData(rows);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [api, version]);
  async function run(action: string, payload: Record<string, unknown>, confirmText?: string) {
    if (busy) return;
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError("");
    try {
      await api.call(action, payload);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel team-panel miniapp-card" data-testid="miniapp-applications">
        <h2>小程序申请</h2>
        <p className="subtle">姓名和完整手机号只有管理员能看到，用来认人。批准后，同一个微信打开小程序即可使用。</p>
        {error && <ErrorNote>{error}</ErrorNote>}
        {!data && !error && <Loading />}
        {data && data.pending.length === 0 && <p className="subtle miniapp-empty">暂时没有待处理的申请。</p>}
        {data && data.pending.length > 0 && (
          <div className="miniapp-list">
            {data.pending.map((a) => (
              <PendingCard
                key={a.id}
                app={a}
                busy={busy}
                linkUid={linkFor[a.id] ?? a.maybe?.[0]?.uid ?? ""}
                onLink={(uid) => setLinkFor((m) => ({ ...m, [a.id]: uid }))}
                onApprove={(linkUid) =>
                  void run(
                    "miniapp.apply.approve",
                    { id: a.id, ...(linkUid ? { linkUid } : {}) },
                    linkUid
                      ? `批准「${a.name}」并关联到已有成员？两边会是同一个身份。`
                      : `批准「${a.name}」为新的小程序成员？`,
                  )
                }
                onReject={() => void run("miniapp.apply.reject", { id: a.id }, `拒绝「${a.name}」的申请？对方 24 小时后才能再申请。`)}
                onBlock={() => void run("miniapp.apply.block", { id: a.id }, `拉黑「${a.name}」这个微信？拉黑后不能再申请。`)}
              />
            ))}
          </div>
        )}
      </section>
      {data && data.blocked.length > 0 && (
        <section className="panel team-panel miniapp-card" data-testid="miniapp-blocked">
          <h2>已拉黑</h2>
          <div className="miniapp-list">
            {data.blocked.map((a) => (
              <article className="miniapp-item" key={a.id}>
                <header>
                  <strong>{a.name}</strong>
                  <span className="team-status disabled">已拉黑</span>
                </header>
                <div className="miniapp-meta">
                  {a.phone ? `${formatAdminPhone(a.phone)} · ` : ""}
                  申请于 <span className="miniapp-time">{bjDateText(a.lastAppliedAt)}</span>
                  {a.decidedAt ? <> · 处理于 <span className="miniapp-time">{bjDateText(a.decidedAt)}</span></> : null}
                </div>
                <div className="team-row">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void run("miniapp.apply.unblock", { id: a.id }, `解除「${a.name}」的拉黑？`)}
                  >
                    解除拉黑
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function PendingCard({
  app,
  busy,
  linkUid,
  onLink,
  onApprove,
  onReject,
  onBlock,
}: {
  app: MiniappApplication;
  busy: boolean;
  linkUid: string;
  onLink: (uid: string) => void;
  onApprove: (linkUid: string) => void;
  onReject: () => void;
  onBlock: () => void;
}) {
  const options = app.maybe || [];
  return (
    <article className="miniapp-item">
      <header>
        <strong>{app.name}</strong>
        <span className="team-status">待批准</span>
      </header>
      <div className="miniapp-meta">
        {formatAdminPhone(app.phone)} · 申请于 <span className="miniapp-time">{bjDateText(app.lastAppliedAt)}</span>
      </div>
      {options.length > 0 && (
        <div className="team-row">
          <label className="subtle" htmlFor={`link-${app.id}`}>
            可能是已有成员
          </label>
          <select
            id={`link-${app.id}`}
            aria-label={`将 ${app.name} 关联到已有成员`}
            value={linkUid}
            onChange={(e) => onLink(e.target.value)}
          >
            <option value="">不关联，作为新成员</option>
            {options.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.name}
                {m.status !== "active" ? `（${m.status}）` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="team-row miniapp-actions">
        <button className="button primary small" disabled={busy} onClick={() => onApprove("")}>
          批准（新成员）
        </button>
        {options.length > 0 && (
          <button className="button secondary small" disabled={busy || !linkUid} onClick={() => onApprove(linkUid)}>
            批准并关联
          </button>
        )}
        <button className="text-button" disabled={busy} onClick={onReject}>
          拒绝
        </button>
        <button className="text-button negative" disabled={busy} onClick={onBlock}>
          拉黑
        </button>
      </div>
    </article>
  );
}

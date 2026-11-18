import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { useTeam } from "../lib/team-ui";
import {
  compareFlags,
  probeMiniapp,
  salesFlagsFromMe,
  UNCOMPARABLE_FLAG_LABELS,
  bjDateText,
  type BindCodeResult,
  type MiniappApi,
  type MiniappBinding,
  type MiniappFlags,
  type MiniappProbe,
} from "../lib/miniapp-api";
import { ErrorNote, Loading, message } from "./ui";
import "../team.css";
import "../miniapp.css";

export function MiniappBindSettings() {
  const { me } = useTeam();
  const [probe, setProbe] = useState<MiniappProbe>({ status: "pending" });
  useEffect(() => {
    if (me.role !== "admin") {
      setProbe({ status: "hidden" });
      return;
    }
    let alive = true;
    setProbe({ status: "pending" });
    void probeMiniapp().then((r) => {
      if (alive) setProbe(r);
    });
    return () => {
      alive = false;
    };
  }, [me.role]);
  if (me.role !== "admin" || probe.status === "hidden") return null;
  if (probe.status === "pending") return null;
  return <BindCard api={probe.api} flags={probe.flags} />;
}

function BindCard({ api, flags }: { api: MiniappApi; flags: MiniappFlags }) {
  const { me } = useTeam();
  const compared = compareFlags(salesFlagsFromMe(me), flags);
  const [bindings, setBindings] = useState<MiniappBinding[]>();
  const [code, setCode] = useState<BindCodeResult>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void api
      .call<MiniappBinding[]>("miniapp.bind.list")
      .then((rows) => {
        if (alive) setBindings(rows);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [api, version]);
  const owners = (bindings || []).filter((b) => b.kind === "owner" && b.status === "active");
  async function generate() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      setCode(await api.call<BindCodeResult>("miniapp.owner.code"));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(b: MiniappBinding) {
    if (busy) return;
    const who = b.kind === "owner" ? "这个管理员微信" : b.name ? `「${b.name}」的小程序绑定` : "这条绑定";
    if (!confirm(`撤销${who}？撤销后需重新绑定或申请。`)) return;
    setBusy(true);
    setError("");
    try {
      await api.call("miniapp.bind.revoke", { id: b.id });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard?.writeText(text);
      setNote("已复制绑定码");
    } catch {
      setNote("请手动抄下绑定码");
    }
  }
  return (
    <section className="panel settings-panel miniapp-card" data-testid="miniapp-bind">
      <div className="panel-heading">
        <div>
          <h2>绑定小程序</h2>
          <p>
            生成 8 位绑定码，10 分钟内有效，只能用一次。在小程序里点「我是管理员 · 输入绑定码」即可绑定你的微信，以后不用再输入。最多绑 2 个微信，方便换手机。
          </p>
        </div>
      </div>
      <div
        className={`miniapp-flagbar ${compared.ok ? "ok" : "bad"}`}
        data-testid="miniapp-flagbar"
        role="status"
      >
        <strong>{compared.ok ? "两边开关一致 ✓" : "两边开关不一致 ✗"}</strong>
        <ul className="miniapp-flags">
          {compared.rows.map((r) => (
            <li key={r.key} className={r.match ? undefined : "mismatch"}>
              {r.label}
              {r.match ? (r.sales ? " 开" : " 关") : ` 网页${r.sales ? "开" : "关"} / 小程序${r.miniapp ? "开" : "关"}`}
            </li>
          ))}
        </ul>
        <p className="miniapp-flag-note">
          只显示开或关。{UNCOMPARABLE_FLAG_LABELS.join("、")}这三项网页暂时还对不上。
        </p>
      </div>
      <div className="form-actions">
        <button className="button primary" disabled={busy} onClick={() => void generate()}>
          生成绑定码
        </button>
        <span className="subtle">已绑定 {owners.length} / 2 个管理员微信</span>
      </div>
      {code && (
        <div className="miniapp-code" role="status">
          <strong>本次绑定码（只显示这一次）</strong>
          <div className="miniapp-code-value">{code.code}</div>
          <small>北京时间 <span className="miniapp-time">{bjDateText(code.expiresAt)}</span> 前有效，用过即失效。离开本页后无法再看，请马上记下或复制。</small>
          <div className="team-row">
            <button className="button secondary" type="button" onClick={() => void copy(code.code)}>
              <Copy size={15} />
              复制绑定码
            </button>
            {note && <span className="subtle">{note}</span>}
          </div>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {!bindings && !error && <Loading />}
      {bindings && bindings.length === 0 && <p className="subtle miniapp-empty">还没有绑定。生成绑定码后，在小程序里输入即可。</p>}
      {bindings && bindings.length > 0 && (
        <div className="miniapp-list">
          {bindings.map((b) => (
            <article className="miniapp-item" key={b.id}>
              <header>
                <strong>{b.name || (b.kind === "owner" ? "管理员" : "小程序成员")}</strong>
                <span className="miniapp-pill">{b.kind === "owner" ? "管理员微信" : "小程序"}</span>
                <span className={`team-status${b.status === "revoked" ? " revoked" : ""}`}>{b.status === "active" ? "使用中" : "已撤销"}</span>
              </header>
              <div className="miniapp-meta">
                绑定于 <span className="miniapp-time">{bjDateText(b.createdAt)}</span>
                {b.lastSeenAt ? <> · 最近使用 <span className="miniapp-time">{bjDateText(b.lastSeenAt)}</span></> : null}
              </div>
              {b.status === "active" && (
                <div className="team-row">
                  <button className="text-button negative" disabled={busy} onClick={() => void revoke(b)}>
                    撤销绑定
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

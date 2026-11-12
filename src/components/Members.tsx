import { useState } from "react";
import { UserPlus, Copy } from "lucide-react";
import type { Api } from "../domain/model";
import { ErrorNote, Loading, message, useQuery } from "./ui";
import "../team.css";

interface Member {
  uid: string;
  name: string;
  status: "pending" | "active" | "disabled";
  createdAt: string;
}
interface Invite {
  id: string;
  name: string;
  expiresAt: string;
}
const STATUS = { pending: "待批准", active: "使用中", disabled: "已停用" } as const;
const bj = (iso: string) =>
  new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

/** 成员管理（仅管理员）：生成邀请、批准、停用/恢复、撤销邀请 */
export function Members({ api }: { api: Api }) {
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useQuery<{ members: Member[]; invites: Invite[] }>(
    api,
    "members.list",
    {},
    version,
  );
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ code: string; name: string; expiresAt: string }>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function run(action: string, payload: unknown) {
    setBusy(true);
    setNote("");
    try {
      const r = await api.call<any>(action, payload);
      setVersion((v) => v + 1);
      return r;
    } catch (e) {
      setNote(message(e));
    } finally {
      setBusy(false);
    }
  }
  const link = created
    ? location.origin + location.pathname + "#/join?code=" + created.code
    : "";
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">团队账号</p>
          <h1>成员管理</h1>
          <p className="subtle">邀请小伙伴登录；成员只能看数据、记一笔、加客户、建日程，不能改系统。</p>
        </div>
      </div>
      <section className="panel team-panel">
        <h2>邀请新成员</h2>
        <form
          className="team-row"
          onSubmit={(e) => {
            e.preventDefault();
            void run("members.invite.create", { name }).then((r) => {
              if (r) {
                setCreated(r);
                setName("");
              }
            });
          }}
        >
          <input
            aria-label="成员备注名"
            placeholder="备注名，如：小王"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="button primary" disabled={busy || !name.trim()}>
            <UserPlus size={16} />
            生成邀请链接
          </button>
        </form>
        {created && (
          <div className="team-invite" role="status">
            <strong>给「{created.name}」的邀请链接（只显示这一次，72 小时内有效）</strong>
            <code data-testid="invite-link">{link}</code>
            <button
              className="button secondary"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(link)}
            >
              <Copy size={15} />
              复制链接
            </button>
            <small>对方用 GitHub 登录后打开链接，你在下方点「批准」才生效。</small>
          </div>
        )}
        {note && <ErrorNote>{note}</ErrorNote>}
      </section>
      <section className="panel team-panel">
        <h2>成员</h2>
        {loading && <Loading />}
        {error && <ErrorNote>{error}</ErrorNote>}
        {data && !data.members.length && <p className="subtle">还没有成员。</p>}
        {data && data.members.length > 0 && (
          <table className="team-table">
            <thead>
              <tr>
                <th>备注名</th>
                <th>状态</th>
                <th>加入时间（北京）</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.uid}>
                  <td>{m.name}</td>
                  <td>
                    <span className={`team-status ${m.status}`}>{STATUS[m.status]}</span>
                  </td>
                  <td>{bj(m.createdAt)}</td>
                  <td>
                    {m.status === "pending" && (
                      <button className="button primary small" disabled={busy} onClick={() => void run("members.approve", { uid: m.uid })}>
                        批准
                      </button>
                    )}
                    {m.status !== "disabled" && (
                      <button className="text-button negative" disabled={busy} onClick={() => void run("members.disable", { uid: m.uid })}>
                        停用
                      </button>
                    )}
                    {m.status === "disabled" && (
                      <button className="text-button" disabled={busy} onClick={() => void run("members.enable", { uid: m.uid })}>
                        恢复
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.invites.length > 0 && (
          <>
            <h3>未使用的邀请</h3>
            <ul className="team-list">
              {data.invites.map((i) => (
                <li key={i.id}>
                  {i.name} · {bj(i.expiresAt)} 前有效
                  <button className="text-button negative" disabled={busy} onClick={() => void run("members.invite.revoke", { id: i.id })}>
                    撤销
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

/** 未入队/待批准/已停用时看到的页面；带 #/join?code= 可直接兑换邀请 */
export function MemberGate({
  api,
  status,
  onDone,
  onLogout,
}: {
  api: Api;
  status: "none" | "pending" | "disabled";
  onDone: () => void;
  onLogout: () => void;
}) {
  // 邀请链接 #/join?code=…：登录跳转回来后 hash 可能已丢，从登录前保存的返回地址里再取一次
  const codeFrom = (hash: string | null) =>
    hash && hash.startsWith("#/join") ? new URLSearchParams(hash.split("?")[1] || "").get("code") || "" : "";
  const fromLink = codeFrom(location.hash) || codeFrom(sessionStorage.getItem("zhangyuge-return-route"));
  const [code, setCode] = useState(fromLink);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="boot team-gate">
      <section className="panel team-panel">
        <h1>
          {status === "pending" ? "等待管理员批准" : status === "disabled" ? "账号已停用" : "加入团队账本"}
        </h1>
        {status === "pending" && <p className="subtle">已收到你的加入申请，管理员批准后刷新即可使用。</p>}
        {status === "disabled" && <p className="subtle">如需恢复，请联系管理员。</p>}
        {status === "none" && (
          <form
            className="team-row"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setNote("");
              api
                .call("members.redeem", { code: code.trim() })
                .then(() => onDone())
                .catch((err) => setNote(message(err)))
                .finally(() => setBusy(false));
            }}
          >
            <input aria-label="邀请码" placeholder="粘贴邀请码" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="button primary" disabled={busy || !code.trim()}>
              提交加入申请
            </button>
          </form>
        )}
        {note && <ErrorNote>{note}</ErrorNote>}
        <div className="team-row">
          <button className="button secondary" onClick={onDone}>
            刷新状态
          </button>
          <button className="text-button" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </section>
    </div>
  );
}

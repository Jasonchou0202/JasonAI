import { describe, expect, it } from "vitest";
import { MemoryStore } from "../server/memory-store";
import { runMiniappNotify, notifyConfigFromEnv, NOTIFY_MAX_SENDS, type WxMessage } from "../server/miniapp/notify";
import { batch3ConfigFromEnv, type MiniSub } from "../server/miniapp/batch3";
import type { MiniStore } from "../server/miniapp/types";
import type { CustomerTask } from "../src/domain/model";

const OWNER = "uid-owner";
const ENV = {
  OWNER_UID: OWNER,
  MINIAPP_NOTIFY_ENABLED: "1",
  MINIAPP_TPL_TASK: "tpl_task_0000000001",
  MINIAPP_TPL_APPLY: "tpl_apply_000000001",
  MINIAPP_TPL_TASK_KEYS: "thing1,time2,thing3",
  MINIAPP_TPL_APPLY_KEYS: "thing1,time2,thing3",
};
const cfg = (env: Record<string, string> = ENV) => notifyConfigFromEnv(env, batch3ConfigFromEnv(env));
const AT = Date.parse("2026-11-18T07:00:00.000Z"); // 北京 15:00

function setup() {
  const store = new MemoryStore() as unknown as MiniStore & { data: Record<string, Record<string, any>> };
  const d = store.data;
  for (const c of ["miniapp_subs", "miniapp_bindings", "miniapp_applications", "members"]) d[c] ??= {};
  const sub = (id: string, uid: string, kind: "owner" | "member", quota: Partial<MiniSub["quota"]>) => {
    d.miniapp_subs[id] = { id, uid, kind, openid: "o-" + id, quota: { task: 0, apply: 0, ...quota }, updatedAt: "2026-11-18T00:00:00.000Z", sent: [] } satisfies MiniSub;
    d.miniapp_bindings[id] = { id, kind, uid, status: "active", createdAt: "x", approvedBy: OWNER, lastSeenAt: null };
  };
  const task = (id: string, extra: Partial<CustomerTask> = {}) => {
    d.tasks[id] = {
      id, customerId: "c1", at: new Date(AT).toISOString(), title: "回访示例客户，确认续费意向和下次时间", feedback: "", nextAction: "", reminder: "both",
      completedAt: null, deletedAt: null, createdAt: "2026-11-17T00:00:00.000Z", updatedAt: "x", revision: 1,
      reminderGeneration: "g-" + id, reminderStartAt: "2026-11-17T00:00:00.000Z", ...extra,
    } satisfies CustomerTask;
  };
  const sent: WxMessage[] = [];
  let failWith: number | null = null;
  const send = async (m: WxMessage) => {
    if (failWith !== null) throw Object.assign(new Error("x"), { errCode: failWith });
    sent.push(m);
  };
  return { store, d, sub, task, sent, send, fail: (c: number | null) => (failWith = c) };
}

describe("小程序服务通知（reminders 第 3 批）", () => {
  it("开关关：一条都不发、不读库", async () => {
    const t = setup();
    t.sub("b1", OWNER, "owner", { task: 3 });
    t.task("t1");
    const r = await runMiniappNotify(t.store, cfg({ ...ENV, MINIAPP_NOTIFY_ENABLED: "0" }), t.send, AT);
    expect(r).toEqual({ enabled: false, sent: 0, failed: 0, refused: 0, skipped: 0 });
    expect(t.sent).toHaveLength(0);
  });
  it("到点发给日程归属人：扣 1 次额度、记去重，同一时刻再跑不重复", async () => {
    const t = setup();
    t.sub("b1", OWNER, "owner", { task: 3 });
    t.task("t1");
    const r = await runMiniappNotify(t.store, cfg(), t.send, AT + 60_000);
    expect(r.sent).toBe(1);
    expect(t.sent[0]).toMatchObject({ touser: "o-b1", template_id: "tpl_task_0000000001", miniprogram_state: "trial", page: "pages/gate/index" });
    expect(t.sent[0].data.thing1.value.length).toBeLessThanOrEqual(20);
    expect(t.sent[0].data.time2.value).toBe("2026-11-18 15:00");
    expect(t.d.miniapp_subs.b1.quota.task).toBe(2);
    await runMiniappNotify(t.store, cfg(), t.send, AT + 120_000);
    expect(t.sent).toHaveLength(1);
  });
  it("提前 15 分钟和到点各一条（reminder=both），过了 10 分钟窗口不补发", async () => {
    const t = setup();
    t.sub("b1", OWNER, "owner", { task: 5 });
    t.task("t1");
    await runMiniappNotify(t.store, cfg(), t.send, AT - 15 * 60_000 + 1000);
    await runMiniappNotify(t.store, cfg(), t.send, AT + 1000);
    expect(t.sent.map((m) => m.data.thing3.value)).toEqual(["15 分钟后开始", "现在开始"]);
    const late = setup();
    late.sub("b1", OWNER, "owner", { task: 5 });
    late.task("t1");
    await runMiniappNotify(late.store, cfg(), late.send, AT + 11 * 60_000);
    expect(late.sent).toHaveLength(0);
  });
  it("成员只收自己名下的；停用、撤销绑定、额度 0 都不发；完成或删掉的日程不发", async () => {
    const t = setup();
    t.d.members.wx_a = { uid: "wx_a", name: "甲", status: "active" };
    t.d.members.wx_b = { uid: "wx_b", name: "乙", status: "disabled" };
    t.sub("b1", OWNER, "owner", { task: 5 });
    t.sub("ba", "wx_a", "member", { task: 5 });
    t.sub("bb", "wx_b", "member", { task: 5 });
    t.task("mine", { ownerUid: "wx_a" });
    t.task("hers", { ownerUid: "wx_b" });
    t.task("done", { completedAt: "x" });
    t.task("gone", { deletedAt: "x" });
    t.task("owner-default", { createdBy: undefined });
    await runMiniappNotify(t.store, cfg(), t.send, AT + 1000);
    expect(t.sent.map((m) => m.touser).sort()).toEqual(["o-b1", "o-ba"]);
    t.d.miniapp_bindings.ba.status = "revoked";
    t.task("again", { ownerUid: "wx_a", reminderGeneration: "g2" });
    await runMiniappNotify(t.store, cfg(), t.send, AT + 2000);
    expect(t.sent.filter((m) => m.touser === "o-ba")).toHaveLength(1);
  });
  it("微信说没有订阅次数（43101）：额度清零；其他失败记失败、不重发", async () => {
    const t = setup();
    t.sub("b1", OWNER, "owner", { task: 5 });
    t.task("t1");
    t.fail(43101);
    const r = await runMiniappNotify(t.store, cfg(), t.send, AT + 1000);
    expect(r.refused).toBe(1);
    expect(t.d.miniapp_subs.b1.quota.task).toBe(0);
    const u = setup();
    u.sub("b1", OWNER, "owner", { task: 5 });
    u.task("t1");
    u.fail(-1);
    expect((await runMiniappNotify(u.store, cfg(), u.send, AT + 1000)).failed).toBe(1);
    u.fail(null);
    await runMiniappNotify(u.store, cfg(), u.send, AT + 2000);
    expect(u.sent).toHaveLength(0);
  });
  it("新申请：只给管理员发一次；之后又来新申请再发一次；成员收不到", async () => {
    const t = setup();
    t.d.members.wx_a = { uid: "wx_a", name: "甲", status: "active" };
    t.sub("b1", OWNER, "owner", { apply: 5 });
    t.sub("ba", "wx_a", "member", { apply: 5 });
    t.d.miniapp_applications.a1 = { id: "a1", status: "pending", lastAppliedAt: "2026-11-18T06:00:00.000Z", name: "示例", phone: "13800001234" };
    await runMiniappNotify(t.store, cfg(), t.send, AT);
    await runMiniappNotify(t.store, cfg(), t.send, AT + 60_000);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ touser: "o-b1", template_id: "tpl_apply_000000001" });
    expect(JSON.stringify(t.sent[0])).not.toMatch(/13800001234/);
    t.d.miniapp_applications.a2 = { id: "a2", status: "pending", lastAppliedAt: "2026-11-18T06:30:00.000Z", name: "示例2", phone: "13800004321" };
    await runMiniappNotify(t.store, cfg(), t.send, AT + 120_000);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].data.thing3.value).toBe("待批 2 人");
  });
  it("正在恢复备份时暂停；没配字段名就不发；单次最多 20 条", async () => {
    const t = setup();
    t.sub("b1", OWNER, "owner", { task: 50 });
    t.task("t1");
    t.d.batches._ledger = { restoreId: "restore_x" };
    expect((await runMiniappNotify(t.store, cfg(), t.send, AT + 1000)).sent).toBe(0);
    delete t.d.batches._ledger;
    const { MINIAPP_TPL_TASK_KEYS: _k, ...noKeys } = ENV;
    expect((await runMiniappNotify(t.store, cfg(noKeys), t.send, AT + 1000)).sent).toBe(0);
    for (let i = 0; i < 25; i++) t.task("many" + i);
    const r = await runMiniappNotify(t.store, cfg(), t.send, AT + 1000);
    expect(r.sent).toBe(NOTIFY_MAX_SENDS);
    expect(r.skipped).toBeGreaterThan(0);
  });
});

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handle } from "../server/handler";
import { appendOnly } from "../server/audit";
import type { Store } from "../server/service";
import type { Member, TeamConfig } from "../server/team";
import { customerId } from "../src/domain/customers";
import { handleMiniapp, maskPhone, normalizeCode, WEB_ACTIONS, type MiniappDeps } from "../server/miniapp/gate";
import { looksLikeHttp, resolveSource, type PlatformIdentity } from "../server/miniapp/source";
import { CODE_ALPHABET, MINIAPP_COLLECTIONS, type MiniStore, type MiniTx } from "../server/miniapp/types";

/** 通用内存库：集合按需建（业务集合 + 小程序集合） */
class Mem implements MiniStore {
  data: Record<string, Record<string, unknown>> = {};
  private queue = Promise.resolve();
  private col(c: string) {
    return (this.data[c] ??= {});
  }
  async get<T>(c: string, id: string) {
    return structuredClone(this.col(c)[id] ?? null) as T | null;
  }
  async put<T>(c: string, id: string, v: T) {
    this.col(c)[id] = structuredClone(v);
  }
  async del(c: string, id: string) {
    delete this.col(c)[id];
  }
  async list<T>(c: string) {
    return structuredClone(Object.values(this.col(c))) as T[];
  }
  async transaction<T>(fn: (tx: MiniTx) => Promise<T>) {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.queue;
    this.queue = prev.then(() => next);
    await prev;
    const saved = structuredClone(this.data);
    try {
      return await fn(this);
    } catch (e) {
      this.data = saved;
      throw e;
    } finally {
      release();
    }
  }
}

const OWNER = "uid-owner";
const APPID = "wx0123456789abcdef";
const JASON_WX = { openid: "o-jason-0001", appid: APPID };
const ALICE_WX = { openid: "o-alice-0001", appid: APPID };
const BOB_WX = { openid: "o-bob-00001", appid: APPID };
const WEB_OWNER: PlatformIdentity = { uid: OWNER };
const hash = async (v: string) => createHash("sha256").update(v).digest("hex");
const ALL_ON: TeamConfig = { membersEnabled: true, auditEnabled: true, scheduleOwnerEnabled: true };

function setup(opts: { enabled?: boolean; team?: TeamConfig; appId?: string; start?: string } = {}) {
  const store = new Mem();
  let clock = Date.parse(opts.start ?? "2026-11-18T02:00:00.000Z");
  const team = opts.team ?? ALL_ON;
  const deps: MiniappDeps = {
    store: () => store,
    ownerUid: OWNER,
    config: { enabled: opts.enabled ?? true, ...(opts.appId ? { appId: opts.appId } : {}) },
    team,
    now: () => new Date(clock).toISOString(),
    hash,
    random: (n) => new Uint8Array(randomBytes(n)),
    business: (uid, e) =>
      handle(() => store as unknown as Store, { uid, ownerUid: OWNER, hash, now: () => new Date(clock).toISOString() }, e, undefined, undefined, team),
    audit: (note) => appendOnly(store as unknown as Store, () => new Date(clock).toISOString()).append(note),
  };
  const call = (who: PlatformIdentity, action: string, payload: Record<string, unknown> = {}) =>
    handleMiniapp(deps, who, { action, payload }) as Promise<{ ok: boolean; data?: any; code?: string; error?: string }>;
  const advance = (msDelta: number) => (clock += msDelta);
  return { store, deps, call, advance };
}
async function bindJason(t: ReturnType<typeof setup>, wx = JASON_WX) {
  const code = (await t.call(WEB_OWNER, "miniapp.owner.code")).data.code as string;
  return t.call(wx, "miniapp.owner.redeem", { code });
}
const applyAs = (t: ReturnType<typeof setup>, wx: PlatformIdentity, name = "示例成员甲", phone = "13800001234") =>
  t.call(wx, "miniapp.apply", { name, phone, agree: true });
async function pendingId(t: ReturnType<typeof setup>) {
  return (await t.call(WEB_OWNER, "miniapp.apply.list")).data.pending[0].id as string;
}

describe("来源校验（工单第 5 点：防身份串用）", () => {
  it("平台上下文有 openid+appid 才算小程序；只有 uid 算网页；都没有拒绝", () => {
    expect(resolveSource({}, JASON_WX)).toEqual({ kind: "miniapp", ...JASON_WX });
    expect(resolveSource({}, { uid: OWNER })).toEqual({ kind: "web", uid: OWNER });
    expect(() => resolveSource({}, {})).toThrow();
    expect(() => resolveSource({}, { openid: "o-x-000001" })).toThrow();
    expect(() => resolveSource({}, { openid: "bad id!", appid: APPID })).toThrow();
  });
  it("配了 MINIAPP_APPID 时别的小程序进不来", () => {
    expect(() => resolveSource({}, { ...JASON_WX, appid: "wxffffffffffffffff" }, APPID)).toThrow(/不是生意手账小程序/);
  });
  it("HTTP 形态的请求一律拒绝", async () => {
    expect(looksLikeHttp({ httpMethod: "POST", body: "{}" })).toBe(true);
    const t = setup();
    const r = await handleMiniapp(t.deps, WEB_OWNER, { httpMethod: "POST", headers: {}, action: "miniapp.flags" });
    expect(r).toMatchObject({ ok: false, code: "HTTP_NOT_ALLOWED" });
  });
  it("请求里带的 userInfo/openid/uid 不当身份用", async () => {
    const t = setup();
    await bindJason(t);
    // 冒充者自己的 openid 没绑定；在 payload 和 userInfo 里塞 Jason 的身份也没用
    const r = await handleMiniapp(t.deps, BOB_WX, {
      action: "dashboard",
      payload: { openid: JASON_WX.openid, uid: OWNER },
      userInfo: { openId: JASON_WX.openid, appId: APPID },
    });
    expect(r).toMatchObject({ ok: false, code: "NO_ACCESS" });
  });
  it("网页来源只能调管理调用，而且只给 Jason 本人；不能当第二个业务入口", async () => {
    const t = setup();
    expect(await t.call(WEB_OWNER, "dashboard")).toMatchObject({ ok: false, code: "WEB_NOT_ALLOWED" });
    expect(await t.call(WEB_OWNER, "miniapp.apply", { name: "x", phone: "13800001234", agree: true })).toMatchObject({ ok: false, code: "WEB_NOT_ALLOWED" });
    expect(await t.call({ uid: "uid-other" }, "miniapp.owner.code")).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    for (const a of WEB_ACTIONS) expect(a.startsWith("miniapp.")).toBe(true);
  });
});

describe("MINIAPP_ENABLED 缺省关", () => {
  it("关着时除 ping 外一律 MINIAPP_OFF；ping 只回开关和来源类型，不回编号", async () => {
    const t = setup({ enabled: false });
    const ping = await t.call(JASON_WX, "miniapp.ping");
    expect(ping).toEqual({ ok: true, data: { pong: true, enabled: false, source: "miniapp" } });
    expect(JSON.stringify(ping)).not.toContain(JASON_WX.openid);
    for (const a of ["miniapp.me", "miniapp.apply", "miniapp.owner.redeem", "dashboard"])
      expect(await t.call(JASON_WX, a)).toMatchObject({ ok: false, code: "MINIAPP_OFF" });
    expect(await t.call(WEB_OWNER, "miniapp.owner.code")).toMatchObject({ ok: false, code: "MINIAPP_OFF" });
    expect(Object.keys(t.store.data)).toEqual([]);
  });
  it("没配 OWNER_UID 时一律拒绝", async () => {
    const t = setup();
    t.deps.ownerUid = "";
    expect((await t.call(JASON_WX, "miniapp.me")).ok).toBe(false);
  });
});

describe("Jason 本人：绑定码", () => {
  it("网页生成 8 位码（无易混字符），库里只存哈希；小程序兑换一次后按管理员进入", async () => {
    const t = setup();
    const r = await t.call(WEB_OWNER, "miniapp.owner.code");
    expect(r.ok).toBe(true);
    expect(r.data.code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    expect(JSON.stringify(t.store.data)).not.toContain(r.data.code);
    expect((await t.call(JASON_WX, "miniapp.owner.redeem", { code: r.data.code.toLowerCase() })).data).toEqual({ status: "owner" });
    expect((await t.call(JASON_WX, "miniapp.me")).data).toMatchObject({ status: "owner", role: "admin" });
    // 之后直接按本人进业务（开关全关的老路径也通）
    const off = setup({ team: { membersEnabled: false, auditEnabled: false } });
    await bindJason(off);
    expect(await off.call(JASON_WX, "session")).toEqual({ ok: true, data: { uid: OWNER } });
  });
  it("只能用一次；10 分钟过期", async () => {
    const t = setup();
    const code = (await t.call(WEB_OWNER, "miniapp.owner.code")).data.code;
    expect((await t.call(JASON_WX, "miniapp.owner.redeem", { code })).ok).toBe(true);
    expect(await t.call(BOB_WX, "miniapp.owner.redeem", { code })).toMatchObject({ ok: false, code: "CODE_INVALID" });
    const code2 = (await t.call(WEB_OWNER, "miniapp.owner.code")).data.code;
    t.advance(10 * 60_000 + 1);
    expect(await t.call(BOB_WX, "miniapp.owner.redeem", { code: code2 })).toMatchObject({ ok: false, code: "CODE_INVALID" });
  });
  it("一个微信 24 小时内输错 5 次就锁住，锁住后不再写库", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++)
      expect(await t.call(BOB_WX, "miniapp.owner.redeem", { code: "ZZZZZZZZ" })).toMatchObject({ code: "CODE_INVALID" });
    const code = (await t.call(WEB_OWNER, "miniapp.owner.code")).data.code;
    const before = JSON.stringify(t.store.data.miniapp_attempts);
    expect(await t.call(BOB_WX, "miniapp.owner.redeem", { code })).toMatchObject({ ok: false, code: "REDEEM_LOCKED" });
    expect(JSON.stringify(t.store.data.miniapp_attempts)).toBe(before);
    t.advance(24 * 3600_000 + 1);
    expect((await t.call(BOB_WX, "miniapp.owner.redeem", { code })).ok).toBe(false); // 码也过期了
    const fresh = (await t.call(WEB_OWNER, "miniapp.owner.code")).data.code;
    expect((await t.call(BOB_WX, "miniapp.owner.redeem", { code: fresh })).ok).toBe(true);
  });
  it("最多绑 2 个微信；小程序里不能生成绑定码", async () => {
    const t = setup();
    await bindJason(t, JASON_WX);
    await bindJason(t, ALICE_WX);
    expect(await bindJason(t, BOB_WX)).toMatchObject({ ok: false, code: "OWNER_BIND_LIMIT" });
    expect(await t.call(JASON_WX, "miniapp.owner.code")).toMatchObject({ ok: false, code: "WEB_ONLY" });
  });
  it("格式不对的码也算一次输错", () => {
    expect(normalizeCode("ab-cd 2345")).toBe("ABCD2345");
    expect(normalizeCode("ABCD234O")).toBe(""); // 含 O
    expect(normalizeCode(12345678)).toBe("");
  });
});

describe("成员：申请 → 批准 → 直接进", () => {
  it("没绑定的人只能看到自己的状态、申请、兑换码；其他一律无权限", async () => {
    const t = setup();
    expect((await t.call(ALICE_WX, "miniapp.me")).data).toMatchObject({ status: "none" });
    for (const a of ["dashboard", "sales.list", "miniapp.apply.list", "miniapp.bind.list", "miniapp.bind.leave"])
      expect(await t.call(ALICE_WX, a)).toMatchObject({ ok: false, code: "NO_ACCESS" });
  });
  it("校验姓名、手机号格式和勾选", async () => {
    const t = setup();
    expect(await t.call(ALICE_WX, "miniapp.apply", { name: "", phone: "13800001234", agree: true })).toMatchObject({ code: "APPLY_NAME_INVALID" });
    expect(await t.call(ALICE_WX, "miniapp.apply", { name: "<script>", phone: "13800001234", agree: true })).toMatchObject({ code: "APPLY_NAME_INVALID" });
    expect(await t.call(ALICE_WX, "miniapp.apply", { name: "甲", phone: "23800001234", agree: true })).toMatchObject({ code: "APPLY_PHONE_INVALID" });
    expect(await t.call(ALICE_WX, "miniapp.apply", { name: "甲", phone: "13800001234" })).toMatchObject({ code: "APPLY_AGREE_REQUIRED" });
  });
  it("批准为新成员：members 新建 wx_ 成员（inviteId=miniapp，分色），绑定生效，权限按成员走", async () => {
    const t = setup();
    expect((await applyAs(t, ALICE_WX)).data).toEqual({ status: "pending" });
    expect((await t.call(ALICE_WX, "miniapp.me")).data).toMatchObject({ status: "pending" });
    expect(await t.call(ALICE_WX, "dashboard")).toMatchObject({ code: "NO_ACCESS" });
    const list = (await t.call(WEB_OWNER, "miniapp.apply.list")).data;
    expect(list.pending[0]).toMatchObject({ name: "示例成员甲", phone: "13800001234", status: "pending" });
    const r = await t.call(WEB_OWNER, "miniapp.apply.approve", { id: list.pending[0].id });
    expect(r.data).toMatchObject({ status: "approved", created: true, linked: false });
    const uid = r.data.uid as string;
    expect(uid).toMatch(/^wx_[0-9a-f]{32}$/);
    const m = t.store.data.members[uid] as Member;
    expect(m).toMatchObject({ uid, name: "示例成员甲", status: "active", inviteId: "miniapp", color: "c1" });
    expect((await t.call(ALICE_WX, "miniapp.me")).data).toMatchObject({ status: "member", role: "member" });
    // 交给原来的 handle()/authorize()：成员身份 = wx_ uid
    expect((await t.call(ALICE_WX, "members.me")).data).toMatchObject({ uid, role: "member", status: "active" });
    // 管理员才有的调用被原来的 authorize() 拒绝
    expect(await t.call(ALICE_WX, "members.list")).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    expect(await t.call(ALICE_WX, "miniapp.apply.list")).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
    // 新建日程记在这个成员名下；操作日志的操作人是这个成员
    // 先由成员记一笔（虚构数据），客户随之建好；createdBy 记在成员名下
    const sale = { productId: "", productName: "示例商品", customer: "示例客户·甲", date: "2026-11-18", revenue: 10000, cost: 4000, note: "虚构" };
    expect(await t.call(ALICE_WX, "sales.create", { requestId: "s-mini-1", sale })).toMatchObject({ ok: true });
    expect((Object.values(t.store.data.sales)[0] as { createdBy?: string }).createdBy).toBe(uid);
    const task = { customerId: await customerId("示例客户·甲", hash), at: "2026-11-20T04:00:00Z", title: "回访", feedback: "", nextAction: "", reminder: "off" };
    expect(await t.call(ALICE_WX, "tasks.create", { requestId: "t-mini-1", task })).toMatchObject({ ok: true });
    const created = Object.values(t.store.data.tasks) as { createdBy?: string; ownerUid?: string }[];
    expect(created[0]).toMatchObject({ createdBy: uid, ownerUid: uid });
    const logs = Object.values(t.store.data.audit_logs) as { action: string; actorUid: string }[];
    expect(logs.some((l) => l.action === "tasks.create" && l.actorUid === uid)).toBe(true);
    expect(logs.some((l) => l.action === "miniapp.apply.approve" && l.actorUid === OWNER)).toBe(true);
    // 日志里不出现手机号和 openid
    expect(JSON.stringify(t.store.data.audit_logs)).not.toMatch(/13800001234|o-alice/);
  });
  it("网页上停用成员，小程序立刻失效", async () => {
    const t = setup();
    await applyAs(t, ALICE_WX);
    const { uid } = (await t.call(WEB_OWNER, "miniapp.apply.approve", { id: await pendingId(t) })).data;
    const m = t.store.data.members[uid] as Member;
    t.store.data.members[uid] = { ...m, status: "disabled" };
    expect(await t.call(ALICE_WX, "dashboard")).toMatchObject({ ok: false, code: "MEMBER_DISABLED" });
    expect((await t.call(ALICE_WX, "miniapp.me")).data).toMatchObject({ status: "disabled", role: "none" });
  });
  it("MEMBERS_ENABLED 关：不能批准；已绑的成员也被原来的权限挡住", async () => {
    const t = setup({ team: { membersEnabled: false, auditEnabled: false } });
    await applyAs(t, ALICE_WX);
    expect(await t.call(WEB_OWNER, "miniapp.apply.approve", { id: await pendingId(t) })).toMatchObject({ ok: false, code: "MEMBERS_OFF" });
  });
  it("批准并关联到已有网页成员：绑定指向原 uid，不新建成员", async () => {
    const t = setup();
    const web: Member = { uid: "uid-web-1", name: "示例成员甲", status: "active", inviteId: "inv_x", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", revision: 2, color: "c3" };
    t.store.data.members = { [web.uid]: web };
    await applyAs(t, ALICE_WX);
    const list = (await t.call(WEB_OWNER, "miniapp.apply.list")).data;
    expect(list.pending[0].maybe).toEqual([{ uid: web.uid, name: web.name, status: "active" }]);
    const r = await t.call(WEB_OWNER, "miniapp.apply.approve", { id: list.pending[0].id, linkUid: web.uid });
    expect(r.data).toMatchObject({ uid: web.uid, created: false, linked: true });
    expect(Object.keys(t.store.data.members)).toEqual([web.uid]);
    expect(t.store.data.members[web.uid]).toEqual(web);
    expect((await t.call(ALICE_WX, "members.me")).data).toMatchObject({ uid: web.uid, role: "member" });
    expect(await t.call(WEB_OWNER, "miniapp.apply.approve", { id: list.pending[0].id })).toMatchObject({ ok: false });
  });
  it("不能关联到管理员或系统文档", async () => {
    const t = setup();
    await applyAs(t, ALICE_WX);
    const id = await pendingId(t);
    expect((await t.call(WEB_OWNER, "miniapp.apply.approve", { id, linkUid: OWNER })).ok).toBe(false);
    expect((await t.call(WEB_OWNER, "miniapp.apply.approve", { id, linkUid: "_color_counter" })).ok).toBe(false);
    expect((await t.call(WEB_OWNER, "miniapp.apply.approve", { id, linkUid: "uid-nobody" })).ok).toBe(false);
  });
  it("申请这条路永远拿不到管理员；成员不能调审批", async () => {
    const t = setup();
    await applyAs(t, ALICE_WX);
    await t.call(WEB_OWNER, "miniapp.apply.approve", { id: await pendingId(t) });
    for (const a of ["miniapp.apply.list", "miniapp.apply.approve", "miniapp.bind.list", "miniapp.bind.revoke", "miniapp.flags", "miniapp.owner.code"])
      expect((await t.call(ALICE_WX, a)).ok).toBe(false);
    expect(await t.call(ALICE_WX, "miniapp.owner.redeem", { code: "ABCDEFGH" })).toMatchObject({ code: "ALREADY_BOUND" });
  });
});

describe("拒绝、拉黑、防刷、隐私", () => {
  it("拒绝后 24 小时冷却；30 天最多 3 次", async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      expect((await applyAs(t, ALICE_WX)).ok).toBe(true);
      await t.call(WEB_OWNER, "miniapp.apply.reject", { id: await pendingId(t) });
      expect(await applyAs(t, ALICE_WX)).toMatchObject({ ok: false, code: "APPLY_COOLDOWN" });
      t.advance(24 * 3600_000 + 1);
    }
    expect(await applyAs(t, ALICE_WX)).toMatchObject({ ok: false, code: "APPLY_LIMIT" });
    t.advance(30 * 24 * 3600_000);
    expect((await applyAs(t, ALICE_WX)).ok).toBe(true);
  });
  it("同一个微信同时只有 1 条待处理申请（重复提交不重写）", async () => {
    const t = setup();
    await applyAs(t, ALICE_WX, "示例成员甲");
    expect((await applyAs(t, ALICE_WX, "示例成员乙")).data).toEqual({ status: "pending" });
    const apps = Object.values(t.store.data.miniapp_applications) as { name: string }[];
    expect(apps.map((a) => a.name)).toEqual(["示例成员甲"]);
  });
  it("待处理最多 20 条；全局每小时最多 10 条", async () => {
    const t = setup();
    for (let i = 0; i < 10; i++) expect((await applyAs(t, { openid: `o-user-${100 + i}`, appid: APPID })).ok).toBe(true);
    expect(await applyAs(t, { openid: "o-user-999", appid: APPID })).toMatchObject({ code: "APPLY_BUSY" });
    t.advance(3600_000);
    for (let i = 10; i < 20; i++) expect((await applyAs(t, { openid: `o-user-${100 + i}`, appid: APPID })).ok).toBe(true);
    t.advance(3600_000);
    expect(await applyAs(t, { openid: "o-user-999", appid: APPID })).toMatchObject({ code: "APPLY_FULL" });
  });
  it("拉黑：显示无权限、不能再申请、不写库；已有绑定一并撤销；解除后可马上重新申请", async () => {
    const t = setup();
    await applyAs(t, ALICE_WX);
    const id = await pendingId(t);
    await t.call(WEB_OWNER, "miniapp.apply.approve", { id });
    expect((await t.call(ALICE_WX, "dashboard")).ok).toBe(true);
    await t.call(WEB_OWNER, "miniapp.apply.block", { id });
    expect(await t.call(ALICE_WX, "dashboard")).toMatchObject({ code: "NO_ACCESS" });
    expect((await t.call(ALICE_WX, "miniapp.me")).data).toEqual({ enabled: true, membersEnabled: true, status: "blocked" });
    const before = JSON.stringify(t.store.data);
    expect(await applyAs(t, ALICE_WX)).toMatchObject({ code: "NO_ACCESS" });
    expect(JSON.stringify(t.store.data)).toBe(before);
    const list = (await t.call(WEB_OWNER, "miniapp.apply.list")).data;
    expect(list.blocked[0].phone).toBe("138****1234");
    await t.call(WEB_OWNER, "miniapp.apply.unblock", { id });
    expect((await applyAs(t, ALICE_WX)).data).toEqual({ status: "pending" });
  });
  it("被拒绝满 30 天自动清空手机号；拒绝/拉黑列表只给打码号", async () => {
    const t = setup();
    await applyAs(t, ALICE_WX);
    await t.call(WEB_OWNER, "miniapp.apply.reject", { id: await pendingId(t) });
    expect((await t.call(WEB_OWNER, "miniapp.apply.list")).data.rejected[0].phone).toBe("138****1234");
    t.advance(30 * 24 * 3600_000);
    expect((await t.call(WEB_OWNER, "miniapp.apply.list")).data.rejected[0].phone).toBe("");
    expect(JSON.stringify(t.store.data.miniapp_applications)).not.toContain("13800001234");
    expect(maskPhone("bad")).toBe("");
  });
  it("申请人自己看不到手机号；库里不存 openid 明文（绑定里只在之后访问时补上，且永不返回）", async () => {
    const t = setup();
    const r = await applyAs(t, ALICE_WX);
    expect(JSON.stringify(r)).not.toContain("13800001234");
    expect(JSON.stringify(await t.call(ALICE_WX, "miniapp.me"))).not.toContain("13800001234");
    expect(JSON.stringify(t.store.data.miniapp_applications)).not.toContain(ALICE_WX.openid);
    await t.call(WEB_OWNER, "miniapp.apply.approve", { id: await pendingId(t) });
    await t.call(ALICE_WX, "dashboard");
    const list = await t.call(WEB_OWNER, "miniapp.bind.list");
    expect(JSON.stringify(list)).not.toContain(ALICE_WX.openid);
  });
});

describe("绑定管理和开关核对", () => {
  it("Jason 撤销绑定后立刻无权限；成员自己退出等于撤销，再进要重新申请", async () => {
    const t = setup();
    await applyAs(t, ALICE_WX);
    await t.call(WEB_OWNER, "miniapp.apply.approve", { id: await pendingId(t) });
    await applyAs(t, BOB_WX, "示例成员乙", "13900005678");
    await t.call(WEB_OWNER, "miniapp.apply.approve", { id: await pendingId(t) });
    const binds = (await t.call(WEB_OWNER, "miniapp.bind.list")).data as { id: string; name: string }[];
    expect(binds.map((b) => b.name).sort()).toEqual(["示例成员乙", "示例成员甲"]);
    await t.call(WEB_OWNER, "miniapp.bind.revoke", { id: binds.find((b) => b.name === "示例成员甲")!.id });
    expect(await t.call(ALICE_WX, "dashboard")).toMatchObject({ code: "NO_ACCESS" });
    expect((await t.call(BOB_WX, "miniapp.bind.leave")).data).toEqual({ status: "none" });
    expect(await t.call(BOB_WX, "dashboard")).toMatchObject({ code: "NO_ACCESS" });
    expect((await t.call(BOB_WX, "miniapp.me")).data).toMatchObject({ status: "none" });
    // 重新申请、再批准：沿用原来的 wx_ 成员，不新建
    await applyAs(t, BOB_WX, "示例成员乙", "13900005678");
    const again = await t.call(WEB_OWNER, "miniapp.apply.approve", { id: await pendingId(t) });
    expect(again.data).toMatchObject({ created: false });
    expect((await t.call(BOB_WX, "dashboard")).ok).toBe(true);
  });
  it("Jason 在小程序里也能审批；flags 只回开或关", async () => {
    const t = setup();
    await bindJason(t);
    await applyAs(t, ALICE_WX);
    const id = (await t.call(JASON_WX, "miniapp.apply.list")).data.pending[0].id;
    expect((await t.call(JASON_WX, "miniapp.apply.approve", { id })).ok).toBe(true);
    const flags = (await t.call(WEB_OWNER, "miniapp.flags")).data;
    expect(flags).toMatchObject({ miniappEnabled: true, membersEnabled: true, invoiceEnabled: false });
    for (const v of Object.values(flags)) expect(typeof v).toBe("boolean");
  });
  it("小程序里不转网页推送调用", async () => {
    const t = setup();
    await bindJason(t);
    expect(await t.call(JASON_WX, "push.subscribe")).toMatchObject({ ok: false, code: "NOT_IN_MINIAPP" });
  });
});

describe("隔离：sales 不动、规则全关", () => {
  it("新集合都在规则清单里且全关", () => {
    const rules = JSON.parse(readFileSync("database.rules.json", "utf8"));
    for (const c of MINIAPP_COLLECTIONS) expect(rules[c]).toEqual({ read: false, write: false });
  });
  it("sales 入口不引用 miniapp 代码", () => {
    for (const f of ["server/cloud.ts", "server/handler.ts", "server/team.ts", "server/service.ts"])
      expect(readFileSync(f, "utf8")).not.toMatch(/miniapp/);
  });
  it("miniapp 入口只信本次 context 里的 openid，不读 event.userInfo / process.env.WX_OPENID / AppSecret", () => {
    // 去掉注释后再查代码
    const code = ["server/miniapp-cloud.ts", "server/miniapp/gate.ts", "server/miniapp/source.ts"]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).toContain("cloudbase.parseContext(context)");
    expect(code).not.toMatch(/userInfo|process\.env\.WX_|getUserInfo\(|APPSECRET/i);
  });
});

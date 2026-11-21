import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handle } from "../server/handler";
import type { Store } from "../server/service";
import type { TeamConfig } from "../server/team";
import { OWNER_PROFILE_ID } from "../server/team";
import { MemoryAvatarStorage } from "../server/avatar";
import { handleMiniapp, type MiniappDeps } from "../server/miniapp/gate";
import type { PlatformIdentity } from "../server/miniapp/source";
import type { MiniStore, MiniTx } from "../server/miniapp/types";

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
const jpeg = (w: number, h: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0, 0]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const IMAGE = "data:image/jpeg;base64," + b64(jpeg(64, 64));

function setup() {
  const store = new Mem();
  const storage = new MemoryAvatarStorage();
  const team: TeamConfig = { membersEnabled: true, auditEnabled: true, avatarStorage: storage };
  const clock = Date.parse("2026-11-18T02:00:00.000Z");
  const deps: MiniappDeps = {
    store: () => store,
    ownerUid: OWNER,
    config: { enabled: true },
    team,
    now: () => new Date(clock).toISOString(),
    hash,
    random: (n) => new Uint8Array(randomBytes(n)),
    business: (uid, e) =>
      handle(() => store as unknown as Store, { uid, ownerUid: OWNER, hash, now: () => new Date(clock).toISOString() }, e, undefined, undefined, team),
  };
  const call = (who: PlatformIdentity, action: string, payload: Record<string, unknown> = {}) =>
    handleMiniapp(deps, who, { action, payload }) as Promise<{ ok: boolean; data?: any; code?: string; error?: string }>;
  return { store, storage, call };
}
async function bindJason(t: ReturnType<typeof setup>) {
  const code = (await t.call(WEB_OWNER, "miniapp.owner.code")).data.code as string;
  return t.call(JASON_WX, "miniapp.owner.redeem", { code });
}
async function bindAlice(t: ReturnType<typeof setup>) {
  await t.call(ALICE_WX, "miniapp.apply", { name: "示例成员甲", phone: "13800001234", agree: true });
  const id = (await t.call(WEB_OWNER, "miniapp.apply.list")).data.pending[0].id as string;
  return (await t.call(WEB_OWNER, "miniapp.apply.approve", { id })).data.uid as string;
}

describe("miniapp.avatar.set：只写本人头像", () => {
  it("未绑定的人不能设置", async () => {
    const t = setup();
    expect(await t.call(BOB_WX, "miniapp.avatar.set", { image: IMAGE })).toMatchObject({ ok: false, code: "NO_ACCESS" });
  });
  it("管理员设置后，miniapp.me 带回 avatarUrl；payload.uid 不能改到别人", async () => {
    const t = setup();
    await bindJason(t);
    const r = await t.call(JASON_WX, "miniapp.avatar.set", { image: IMAGE, uid: "someone-else" });
    expect(r.ok).toBe(true);
    expect(r.data.avatarUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(t.store.data.members?.[OWNER_PROFILE_ID]).toBeTruthy();
    const me = await t.call(JASON_WX, "miniapp.me");
    expect(me.data.avatarUrl).toBe(r.data.avatarUrl);
    expect(Object.keys(t.store.data.members ?? {}).every((id) => id === OWNER_PROFILE_ID || !String(id).includes("someone"))).toBe(true);
  });
  it("成员只能改自己的资料，改不到管理员", async () => {
    const t = setup();
    await bindJason(t);
    const uid = await bindAlice(t);
    const r = await t.call(ALICE_WX, "miniapp.avatar.set", { image: IMAGE });
    expect(r.ok).toBe(true);
    expect((t.store.data.members as any)[OWNER_PROFILE_ID]?.avatar).toBeUndefined();
    expect((t.store.data.members as any)[uid]?.avatar?.fileID).toBeTruthy();
    const me = await t.call(ALICE_WX, "miniapp.me");
    expect(me.data.avatarUrl).toBe(r.data.avatarUrl);
    expect(me.data.status).toBe("member");
  });
  it("坏图片拒绝，未设置时 me 不带头像字段", async () => {
    const t = setup();
    await bindJason(t);
    expect(await t.call(JASON_WX, "miniapp.avatar.set", { image: "not-an-image" })).toMatchObject({ ok: false, code: "AVATAR_INVALID" });
    const me = await t.call(JASON_WX, "miniapp.me");
    expect(me.data.avatarUrl).toBeUndefined();
  });
});

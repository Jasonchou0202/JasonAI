import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handle } from "../server/handler";
import { MemoryReceiptStorage } from "../server/receipts";
import { appendOnly } from "../server/audit";
import type { Store } from "../server/service";
import type { TeamConfig } from "../server/team";
import { handleMiniapp, type MiniappDeps } from "../server/miniapp/gate";
import { type PlatformIdentity } from "../server/miniapp/source";
import { type MiniStore, type MiniTx } from "../server/miniapp/types";
import { allowedCdnUrl, cdnHostsFromEnv, DEFAULT_CDN_HOSTS, FILE_CHUNK, RELAY_MAX, type FileFetcher } from "../server/miniapp/extras";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import * as B from "../src/miniapp-b2/index";

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
/** 假 CDN：只认测试里放进去的地址；记下每次读取 */
class FakeCdn implements FileFetcher {
  files = new Map<string, Uint8Array>();
  reads: string[] = [];
  cdnHosts = DEFAULT_CDN_HOSTS;
  async fetch(url: string, o: { start?: number; end?: number; max?: number }) {
    this.reads.push(url);
    const all = this.files.get(url);
    if (!all) throw new Error("not found");
    const s = o.start ?? 0;
    const e = o.end !== undefined ? o.end + 1 : o.max ?? all.length;
    return { bytes: all.subarray(s, Math.min(e, all.length)), total: all.length };
  }
}

function setup(opts: { enabled?: boolean; team?: TeamConfig; appId?: string; start?: string } = {}) {
  const store = new Mem();
  const cdn = new FakeCdn();
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
    files: cdn,
    audit: (note) => appendOnly(store as unknown as Store, () => new Date(clock).toISOString()).append(note),
  };
  const call = (who: PlatformIdentity, action: string, payload: Record<string, unknown> = {}) =>
    handleMiniapp(deps, who, { action, payload }) as Promise<{ ok: boolean; data?: any; code?: string; error?: string }>;
  const advance = (msDelta: number) => (clock += msDelta);
  return { store, deps, call, advance, cdn };
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
/** 第 2 批测试：小程序附加调用（图表统计、CSV、文件中转/分块下载）+ 分包共用计算 + 分包页面静态检查 */
async function bindAlice(t: ReturnType<typeof setup>) {
  await applyAs(t, ALICE_WX);
  return (await t.call(WEB_OWNER, "miniapp.apply.approve", { id: await pendingId(t) })).data.uid as string;
}
const SALE = { productId: "p-demo", productName: "示例商品", customer: "示例客户甲", date: "2026-11-03", revenue: 12000, cost: 4000, note: "" };
async function seedSales(t: ReturnType<typeof setup>) {
  await bindJason(t);
  for (const [i, s] of [
    SALE,
    { ...SALE, date: "2026-10-12", customer: "示例客户乙", revenue: 30000, cost: 9000 },
    { ...SALE, date: "2026-11-10", productId: "p-demo2", productName: "示例商品二", revenue: 5000, cost: 1000 },
  ].entries())
    expect((await t.call(JASON_WX, "sales.create", { requestId: "s" + i, sale: s })).ok).toBe(true);
}

describe("CDN 地址白名单（文件中转只读这些域名）", () => {
  const H = DEFAULT_CDN_HOSTS;
  it("只认 https + 白名单后缀；IP、端口、账号密码、http、相似域名都拒绝", () => {
    expect(allowedCdnUrl("https://a1b2-demo.tcb.qcloud.la/tmp/x.pdf?sign=1", H)).toMatch(/^https:\/\/a1b2-demo\.tcb\.qcloud\.la\//);
    for (const bad of [
      "http://a.tcb.qcloud.la/x", "https://tcb.qcloud.la.evil.com/x", "https://eviltcb.qcloud.la/x", "https://.tcb.qcloud.la/x",
      "https://user:pw@a.tcb.qcloud.la/x", "https://a.tcb.qcloud.la:8443/x", "https://127.0.0.1/x", "https://[::1]/x",
      "file:///etc/passwd", "javascript:alert(1)", 42, null, "https://a.tcb.qcloud.la/" + "x".repeat(3000),
    ])
      expect(allowedCdnUrl(bad, H)).toBeNull();
  });
  it("MINIAPP_CDN_HOSTS 可覆盖；格式不对时回到缺省", () => {
    expect(cdnHostsFromEnv({})).toEqual(DEFAULT_CDN_HOSTS);
    expect(cdnHostsFromEnv({ MINIAPP_CDN_HOSTS: ".example-cdn.com, bad host, " })).toEqual([".example-cdn.com"]);
    expect(cdnHostsFromEnv({ MINIAPP_CDN_HOSTS: "evil.com" })).toEqual(DEFAULT_CDN_HOSTS);
  });
});

describe("附加调用的身份门", () => {
  it("没绑定、网页来源、待审核都进不来；不碰业务库", async () => {
    const t = setup();
    for (const a of ["miniapp.insights", "miniapp.export.csv", "miniapp.files.relay", "miniapp.files.chunk"]) {
      expect((await t.call(BOB_WX, a)).ok).toBe(false);
      expect((await t.call(WEB_OWNER, a)).ok).toBe(false);
    }
    await applyAs(t, ALICE_WX);
    expect((await t.call(ALICE_WX, "miniapp.insights")).ok).toBe(false);
    expect(t.store.data.sales).toBeUndefined();
  });
  it("MINIAPP_ENABLED 关着时一律 MINIAPP_OFF", async () => {
    const t = setup({ enabled: false });
    expect(await t.call(JASON_WX, "miniapp.insights")).toMatchObject({ ok: false, code: "MINIAPP_OFF" });
  });
  it("网页上停用的成员，附加调用同样失效（权限交给原来的 handle()）", async () => {
    const t = setup();
    await bindJason(t);
    const uid = await bindAlice(t);
    expect((await t.call(ALICE_WX, "miniapp.insights")).ok).toBe(true);
    t.store.data.members[uid] = { ...(t.store.data.members[uid] as object), status: "disabled" };
    expect(await t.call(ALICE_WX, "miniapp.insights")).toMatchObject({ ok: false, code: "MEMBER_DISABLED" });
  });
});

describe("miniapp.insights：看板剩余 4 张图", () => {
  it("新增客户走势、每月四色块、矩阵三档、需求占比；只回汇总，不回明细", async () => {
    const t = setup();
    await seedSales(t);
    const r = await t.call(JASON_WX, "miniapp.insights");
    expect(r.ok).toBe(true);
    const d = r.data;
    expect(d.today).toBe("2026-11-18");
    expect(d.newCustomers).toEqual([{ month: "2026-10", count: 1 }, { month: "2026-11", count: 1 }]);
    expect(d.quadMonths.map((m: any) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect(Object.keys(d.matrix)).toEqual(["month", "quarter", "year"]);
    const sum = (k: string) => Object.values(d.matrix[k]).reduce((a: number, q: any) => a + q.count, 0);
    expect(sum("month")).toBe(2);
    expect(sum("quarter")).toBe(3);
    expect(sum("year")).toBe(3);
    expect(d.needs).toMatchObject({ total: 0, rows: [] });
    // 汇总里没有客户名
    expect(JSON.stringify(d)).not.toMatch(/示例客户/);
  });
  it("成员也能看（和网页看板一样）", async () => {
    const t = setup();
    await seedSales(t);
    await bindAlice(t);
    expect((await t.call(ALICE_WX, "miniapp.insights")).ok).toBe(true);
  });
});

describe("miniapp.export.csv", () => {
  it("只给管理员；成员拒绝", async () => {
    const t = setup();
    await seedSales(t);
    await bindAlice(t);
    expect(await t.call(ALICE_WX, "miniapp.export.csv")).toMatchObject({ ok: false, code: "ADMIN_ONLY" });
  });
  it("分块拼起来就是完整 CSV；带 BOM 和表头；文件名带北京日期；筛选透传", async () => {
    const t = setup();
    await seedSales(t);
    const first = await t.call(JASON_WX, "miniapp.export.csv");
    expect(first.ok).toBe(true);
    expect(first.data).toMatchObject({ rows: 3, offset: 0, next: null, name: "销售明细-2026-11-18.csv" });
    expect(first.data.text.length).toBe(first.data.length);
    expect(first.data.text.split("\n").filter(Boolean)).toHaveLength(4);
    const nov = await t.call(JASON_WX, "miniapp.export.csv", { from: "2026-11-01", to: "2026-11-30" });
    expect(nov.data.rows).toBe(2);
    expect(await t.call(JASON_WX, "miniapp.export.csv", { offset: -1 })).toMatchObject({ ok: false });
  });
  it("大文件分多块，next 接得上", async () => {
    const t = setup();
    await bindJason(t);
    const long = "备".repeat(190);
    for (let i = 0; i < 450; i++)
      await t.call(JASON_WX, "sales.create", { requestId: "b" + i, sale: { ...SALE, note: long } });
    let offset: number | null = 0;
    let text = "";
    let parts = 0;
    let length = 0;
    while (offset !== null) {
      const r: any = await t.call(JASON_WX, "miniapp.export.csv", { offset });
      expect(r.ok).toBe(true);
      text += r.data.text;
      length = r.data.length;
      offset = r.data.next;
      parts++;
    }
    expect(parts).toBeGreaterThan(1);
    expect(text.length).toBe(length);
  });
});

const PDF = Buffer.from("%PDF-1.4\n" + "0".repeat(600_000));
const CDN_URL = "https://demo-1234.tcb.qcloud.la/tmp/receipt.pdf";

describe("文件中转上传 / 分块下载（权限都走原来的调用）", () => {
  function withReceipts() {
    const team: TeamConfig = { ...ALL_ON, expensesEnabled: true, expenseReceiptsEnabled: true, receiptStorage: new CdnReceiptStorage() };
    const t = setup({ team });
    t.store.data.expenses = { _settings: { partnerUid: "uid-partner", partnerName: "示例成员乙", categories: [{ id: "cat-phone", name: "话费", preset: true, createdAt: "2026-11-01T00:00:00.000Z" }] } };
    return t;
  }
  it("白名单外的地址不读；超过 4MB 拒绝；目标只能是两个上传调用", async () => {
    const t = withReceipts();
    await bindJason(t);
    expect(await t.call(JASON_WX, "miniapp.files.relay", { target: "expenses.receipts.upload", url: "https://evil.example.com/x.pdf" })).toMatchObject({ ok: false, code: "BAD_FILE_URL" });
    expect(t.cdn.reads).toEqual([]);
    expect(await t.call(JASON_WX, "miniapp.files.relay", { target: "sales.create", url: CDN_URL })).toMatchObject({ ok: false });
    t.cdn.files.set(CDN_URL, new Uint8Array(RELAY_MAX + 10));
    expect(await t.call(JASON_WX, "miniapp.files.relay", { target: "expenses.receipts.upload", url: CDN_URL })).toMatchObject({ ok: false, error: "文件不能超过 4MB" });
  });
  it("中转后存进报销凭证，再用 receipts.urls 授权分块下载，拼回原文件", async () => {
    const t = withReceipts();
    await bindJason(t);
    t.cdn.files.set(CDN_URL, new Uint8Array(PDF));
    const up = await t.call(JASON_WX, "miniapp.files.relay", { target: "expenses.receipts.upload", url: CDN_URL, name: "示例.pdf" });
    expect(up).toMatchObject({ ok: true, data: { type: "application/pdf" } });
    const created = await t.call(JASON_WX, "expenses.create", {
      requestId: "e1",
      expense: { date: "2026-11-14", categoryId: "cat-phone", categoryName: "话费", amount: 1000, note: "", paidBy: OWNER, hasInvoice: false, status: "pending_reimburse", receipts: [{ fileID: up.data.fileID, name: "示例.pdf", type: "application/pdf", size: up.data.size, kind: "invoice" }] },
    });
    expect(created.ok).toBe(true);
    // 临时链接指向假 CDN 上的同一份内容
    const urls = await t.call(JASON_WX, "expenses.receipts.urls", { id: "e1" });
    t.cdn.files.set(urls.data.items[0].url, new Uint8Array(PDF));
    const chunks: Buffer[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const r: any = await t.call(JASON_WX, "miniapp.files.chunk", { via: "expenses.receipts.urls", id: "e1", index: 0, offset });
      expect(r.ok).toBe(true);
      expect(Buffer.from(r.data.data, "base64").length).toBeLessThanOrEqual(FILE_CHUNK);
      chunks.push(Buffer.from(r.data.data, "base64"));
      offset = r.data.next;
    }
    expect(Buffer.concat(chunks).equals(PDF)).toBe(true);
    expect(await t.call(JASON_WX, "miniapp.files.chunk", { via: "sales.list", id: "e1", index: 0 })).toMatchObject({ ok: false });
    expect(await t.call(JASON_WX, "miniapp.files.chunk", { via: "expenses.receipts.urls", id: "e1", index: 5 })).toMatchObject({ ok: false, error: "附件不存在" });
  });
  it("授权成员可以下载别人的报销凭证", async () => {
    const t = withReceipts();
    await bindJason(t);
    await bindAlice(t);
    t.cdn.files.set(CDN_URL, new Uint8Array(PDF));
    const up = await t.call(JASON_WX, "miniapp.files.relay", { target: "expenses.receipts.upload", url: CDN_URL });
    await t.call(JASON_WX, "expenses.create", {
      requestId: "e2",
      expense: { date: "2026-11-14", categoryId: "cat-phone", categoryName: "话费", amount: 1000, note: "", paidBy: OWNER, hasInvoice: false, status: "pending_reimburse", receipts: [{ fileID: up.data.fileID, name: "a.pdf", type: "application/pdf", size: up.data.size, kind: "invoice" }] },
    });
    const urls = await t.call(ALICE_WX, "expenses.receipts.urls", { id: "e2" });
    expect(urls.ok).toBe(true);
    t.cdn.files.set(urls.data.items[0].url, new Uint8Array(PDF));
    const chunk = await t.call(ALICE_WX, "miniapp.files.chunk", { via: "expenses.receipts.urls", id: "e2", index: 0, offset: 0 });
    expect(chunk.ok).toBe(true);
  });
});

/** 内存版凭证存储：临时链接给一个假 CDN 地址（真环境是云存储临时链接） */
class CdnReceiptStorage extends MemoryReceiptStorage {
  async tempUrls(ids: string[]) {
    return new Map(ids.filter((id) => this.files.has(id)).map((id) => [id, "https://demo-1234.tcb.qcloud.la/" + encodeURIComponent(id)]));
  }
}

describe("分包共用计算 b2.js", () => {
  it("产物和源码一致（改了 src/miniapp-b2 要重新生成）", () => {
    expect(() => execFileSync(process.execPath, ["scripts/build-miniapp-b2.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
  });
  it("在没有完整 Intl 的环境（微信基础库）也能算", () => {
    const src = readFileSync("miniprogram/pkg2/lib/b2.js", "utf8");
    const mod = { exports: {} as any };
    vm.runInNewContext(src, { module: mod, exports: mod.exports, console, Intl: undefined });
    expect(mod.exports.yuan(123456)).toBe(B.yuan(123456));
    expect(mod.exports.yuan(123456)).toBe("¥1,235");
    expect(mod.exports.bjTime("2026-11-18T02:00:00.000Z")).toBe("2026-11-18 10:00");
    expect(typeof mod.exports.today()).toBe("string");
    expect(mod.exports.inviteLink("AB CD")).toBe("https://jasonchou0202.github.io/JasonAI/#/join?code=AB%20CD");
  });
  it("开票金额、状态步骤、文件检查", () => {
    expect(B.parseInvoiceAmount("1,234.5")).toBe(123450);
    expect(B.invoiceAmountInput(123450)).toBe("1234.50");
    expect(B.invoiceAmountInput(100)).toBe("1");
    expect(B.invoiceFileCheck({ name: "a.exe", size: 10 }, "invoice")).toBeTruthy();
    expect(B.ISSUED_LIKE("sent")).toBe(true);
    expect(B.ISSUED_LIKE("pending")).toBe(false);
  });
  it("成员列表：待批准不分色；小程序成员打标签；同色提示", () => {
    const v = B.membersView(
      [
        { uid: "u1", name: "甲", status: "active", createdAt: "2026-11-01T00:00:00.000Z", color: "amber" },
        { uid: "wx_2", name: "乙", status: "pending", createdAt: "2026-11-02T00:00:00.000Z" },
        { uid: "u3", name: "丙", status: "disabled", createdAt: "2026-11-03T00:00:00.000Z", color: "amber" },
      ],
      "owner",
      true,
    );
    expect(v.rows[1]).toMatchObject({ statusText: "待批准", miniapp: true, color: "", colorName: "批准后分色" });
    expect(v.rows[0].sameColor).toContain("丙");
    expect(v.needFill).toBe(false);
  });
  it("四色块窗口和拖动：三个月一屏，滑到头为止", () => {
    const rows = ["2026-08", "2026-09", "2026-10", "2026-11"].map((month, i) => ({ month, active: 4, counts: { newOld: i, newNew: 1, oldOld: 2, oldNew: 0 } as any }));
    const v = B.quadMonthsView(rows, 99);
    expect(v.months.map((m) => m.month)).toEqual(["2026.09", "2026.10", "2026.11"]);
    expect(v).toMatchObject({ last: 3, minEnd: 2, range: "2026.09 – 2026.11" });
    expect(B.quadMonthsView(rows, 0).months).toHaveLength(1);
    const pts = B.lineChart([{ month: "2026-10", count: 1 }, { month: "2026-11", count: 3 }], 300, 200).points;
    expect(pts[1].y).toBeLessThan(pts[0].y);
  });
  it("回收站和日志文案", () => {
    const rows = B.auditView([{ id: "a1", at: "2026-11-18T02:00:00.000Z", actorUid: "u1", action: "sales.create", result: "denied", targetType: "sales", targetId: "s1" } as any], () => "甲", () => undefined);
    expect(rows[0]).toMatchObject({ who: "甲", resultText: "被拒", at: expect.stringContaining("10:00") });
    // 网页还没收录的报销、开票动作也有中文
    expect(B.auditActionText({ action: "expenses.delete" } as any)).toBe("删除报销");
    expect(B.auditActionText({ action: "invoices.update" } as any)).toBe("更新开票状态");
    expect(B.auditActionText({ action: "made.up" } as any)).toBe("made.up");
  });
});

describe("分包页面静态检查", () => {
  const root = "miniprogram/pkg2";
  const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  const pages: string[] = app.subpackages.find((s: any) => s.root === "pkg2").pages;
  it("app.json 里的每个分包页面四件套齐全；目录里没有漏登记的页面", () => {
    for (const p of pages) for (const ext of ["js", "json", "wxml", "wxss"]) expect(() => readFileSync(`${root}/${p}.${ext}`)).not.toThrow();
    const onDisk = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "lib")
      .flatMap((d) => readdirSync(`${root}/${d.name}`).filter((f) => f.endsWith(".wxml")).map((f) => `${d.name}/${f.replace(/\.wxml$/, "")}`));
    expect(onDisk.sort()).toEqual([...pages].sort());
  });
  it("WXML 里不调方法（小程序不支持）；页面用品牌奶油底", () => {
    for (const p of pages) {
      const wxml = readFileSync(`${root}/${p}.wxml`, "utf8");
      for (const m of wxml.matchAll(/\{\{([^}]*)\}\}/g)) expect(m[1], `${p}: ${m[1]}`).not.toMatch(/[A-Za-z_]\w*\s*\(/);
      expect(JSON.parse(readFileSync(`${root}/${p}.json`, "utf8")).navigationBarBackgroundColor).toBe("#FBF3E4");
    }
  });
  it("bindtap 等事件都指向页面里定义的方法", () => {
    for (const p of pages) {
      const wxml = readFileSync(`${root}/${p}.wxml`, "utf8");
      const js = readFileSync(`${root}/${p}.js`, "utf8");
      for (const m of wxml.matchAll(/bind(?:tap|input|change|blur|confirm|longpress)="(\w+)"/g))
        expect(js, `${p} 缺少 ${m[1]}`).toMatch(new RegExp(`(^|\\s)${m[1]}(\\(|:)`, "m"));
    }
  });
  it("页面 JS 用到的共用计算都在 b2.js 里", () => {
    const keys = new Set(Object.keys(B));
    for (const p of pages)
      for (const m of readFileSync(`${root}/${p}.js`, "utf8").matchAll(/\bb2\.(\w+)/g)) expect(keys.has(m[1]), `${p}: b2.${m[1]}`).toBe(true);
  });
  it("不在分包里写死账号、密钥或真实客户数据", () => {
    for (const p of pages) {
      const all = ["js", "wxml"].map((e) => readFileSync(`${root}/${p}.${e}`, "utf8")).join("\n");
      expect(all).not.toMatch(/sk-|secret|password|private-data|1[3-9]\d{9}/i);
    }
  });
});

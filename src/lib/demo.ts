import { MemoryStore } from "../../server/memory-store";
import { execute } from "../../server/service";
import { handle } from "../../server/handler";
import { addDays, today } from "../domain/dates";
import { NEW_CUTOFF } from "../domain/insights";
import type { Api, AppState, Product, Sale } from "../domain/model";
import { ApiError } from "./team-me";
import { MemoryAvatarStorage } from "../../server/avatar";
import { customerId } from "../domain/customers";
import type { CustomerTask } from "../domain/model";
export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const buffer =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const key = "zhangyuge-demo-v1";
/** 演示「团队预览」：sessionStorage 里 zhangyuge-demo-role 为 admin/member 时，演示账本走团队权限和操作日志 */
export const DEMO_ROLE_KEY = "zhangyuge-demo-role";
export function demoRole(): "admin" | "member" | null {
  // 打开 …/JasonAI/?team-preview=admin（或 member）进入演示团队预览；默认演示不变
  const fromUrl = new URLSearchParams(location.search).get("team-preview");
  if (fromUrl === "admin" || fromUrl === "member") sessionStorage.setItem(DEMO_ROLE_KEY, fromUrl);
  const r = sessionStorage.getItem(DEMO_ROLE_KEY);
  return r === "admin" || r === "member" ? r : null;
}
/** 演示「日程归属预览」：…/JasonAI/?team-preview=admin&owner-preview=1，演示账本打开日程归属、成员颜色、头像三个开关（全是假数据） */
export const DEMO_OWNER_KEY = "zhangyuge-demo-owner";
export function demoOwnerPreview(): boolean {
  const fromUrl = new URLSearchParams(location.search).get("owner-preview");
  if (fromUrl === "1") sessionStorage.setItem(DEMO_OWNER_KEY, "1");
  if (fromUrl === "0") sessionStorage.removeItem(DEMO_OWNER_KEY);
  return sessionStorage.getItem(DEMO_OWNER_KEY) === "1";
}
const AVATAR_KEY = "zhangyuge-demo-avatars";
/** 演示里的「云存储」：图片存在本机 localStorage，临时链接就是 data: 地址 */
class DemoAvatarStorage extends MemoryAvatarStorage {
  constructor() {
    super();
    try {
      const saved = JSON.parse(localStorage.getItem(AVATAR_KEY) || "{}") as Record<string, string>;
      for (const [id, b64] of Object.entries(saved)) this.files.set(id, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    } catch {
      /* 坏了就当没有 */
    }
  }
  private save() {
    const out: Record<string, string> = {};
    for (const [id, b] of this.files) {
      let bin = "";
      for (const x of b) bin += String.fromCharCode(x);
      out[id] = btoa(bin);
    }
    localStorage.setItem(AVATAR_KEY, JSON.stringify(out));
  }
  async upload(path: string, bytes: Uint8Array) {
    const id = await super.upload(path, bytes);
    this.save();
    return id;
  }
  async remove(id: string) {
    await super.remove(id);
    this.save();
  }
}
/** 演示成员（虚构）：入队顺序决定颜色 */
const DEMO_PEOPLE = [
  { uid: "demo-member", name: "林小雅", color: "c1", at: "2026-11-01T00:00:00.000Z" },
  { uid: "demo-song", name: "宋阿木", color: "c2", at: "2026-11-02T00:00:00.000Z" },
  { uid: "demo-chen", name: "陈一一", color: "c3", at: "2026-11-03T00:00:00.000Z" },
  { uid: "demo-he", name: "何小乐", color: "c4", at: "2026-11-04T00:00:00.000Z" },
  { uid: "demo-su", name: "苏北北", color: "c5", at: "2026-11-05T00:00:00.000Z" },
  { uid: "demo-tang", name: "唐果果", color: "c6", at: "2026-11-06T00:00:00.000Z" },
  { uid: "demo-bai", name: "白小舟", color: "c7", at: "2026-11-07T00:00:00.000Z" },
] as const;
export function createDemo(role: "admin" | "member" | null = null): Api {
  const ownerPreview = role !== null && demoOwnerPreview();
  const avatarStorage = ownerPreview ? new DemoAvatarStorage() : undefined;
  const store = new MemoryStore();
  const saved = localStorage.getItem(key);
  if (saved) {
    try {
      store.data = { ...store.data, ...JSON.parse(saved) };
    } catch {
      seed();
    }
  } else seed();
  function seed() {
    const names = [
      "Plus 会员",
      "Plus 成品号",
      "Claude Pro",
      "AI 工具年卡",
      "其他服务",
    ];
    const prices = [18000, 25800, 25800, 9900, 30000];
    const costs = [8500, 10500, 11500, 3500, 8000];
    names.forEach((name, i) => {
      const p: Product = {
        id: "demo-p-" + i,
        name,
        price: prices[i],
        cost: costs[i],
        active: true,
        order: i,
      };
      store.data.products[p.id] = p;
    });
    for (let d = 0; d < 90; d++) {
      const count = d % 9 === 5 ? 0 : 1 + ((d * 7) % 5);
      for (let j = 0; j < count; j++) {
        const i = (d + j) % 5;
        const date = addDays(today(), -d);
        const time = `${date}T${String(9 + j).padStart(2, "0")}:15:00.000Z`;
        const r: Sale = {
          id: `demo-${d}-${j}`,
          productId: "demo-p-" + i,
          productName: names[i],
          customer: [
            "示例客户 · 小林",
            "示例客户 · 阿远",
            "示例客户 · 木木",
            "示例客户 · 陈同学",
          ][j % 4],
          date,
          revenue: d === 4 && j === 0 ? 0 : prices[i],
          cost: costs[i],
          note: "虚构演示记录",
          createdAt: time,
          updatedAt: time,
          deletedAt: null,
          revision: 1,
        };
        store.data.sales[r.id] = r;
      }
    }
    // 演示四象限：分界日后新增的客户和商品（虚构）
    if (today() < NEW_CUTOFF) return;
    const fresh: Product = { id: "demo-p-new", name: "AI 新品体验课", price: 19900, cost: 6000, active: true, order: 5 };
    store.data.products[fresh.id] = fresh;
    const day = today();
    (
      [
        ["demo-new-1", "demo-p-0", names[0], "示例新客 · 小周", prices[0], costs[0]],
        ["demo-new-2", fresh.id, fresh.name, "示例客户 · 小林", fresh.price, fresh.cost],
        ["demo-new-3", fresh.id, fresh.name, "示例新客 · 阿杰", fresh.price, fresh.cost],
      ] as const
    ).forEach(([id, productId, productName, customer, revenue, cost], j) => {
      const time = `${day}T0${j + 1}:30:00.000Z`;
      store.data.sales[id] = { id, productId, productName, customer, date: day, revenue, cost, note: "虚构演示记录", createdAt: time, updatedAt: time, deletedAt: null, revision: 1 };
    });
  }
  /** 日程归属预览的假数据：7 位成员（固定颜色）+ 本月各人名下的日程 */
  async function seedOwnerPreview() {
    for (const p of DEMO_PEOPLE)
      store.data.members[p.uid] = {
        uid: p.uid, name: p.name, status: "active", inviteId: "demo", color: p.color,
        createdAt: p.at, updatedAt: p.at, revision: 1,
      };
    await execute(store, { uid: "demo", ownerUid: "demo", hash: sha256 }, "customers.list", {});
    const day = today();
    const plan: [number, string, string, string, string | undefined, string | undefined][] = [
      [0, "02:00", "示例客户 · 小林", "续费回访", undefined, "demo-song"],
      [0, "06:30", "示例客户 · 阿远", "Plus 成品号交付", "demo-member", undefined],
      [0, "08:00", "示例客户 · 木木", "新客报价", "demo-song", undefined],
      [0, "11:30", "示例客户 · 陈同学", "售后答疑", "demo-chen", undefined],
      [1, "03:00", "示例客户 · 小林", "确认续费意向", undefined, undefined],
      [1, "07:00", "示例客户 · 阿远", "发使用指南", "demo-member", undefined],
      [2, "05:00", "示例客户 · 木木", "约下次沟通", "demo-chen", undefined],
      [3, "02:30", "示例客户 · 陈同学", "回访满意度", "demo-song", undefined],
      [-1, "04:00", "示例客户 · 小林", "上周跟进复盘", undefined, "demo-member"],
      [-2, "06:00", "示例客户 · 阿远", "补发发票", "demo-chen", undefined],
      [5, "03:00", "示例客户 · 木木", "新品体验邀约", "demo-member", undefined],
      [6, "08:00", "示例客户 · 陈同学", "节前问候", undefined, undefined],
      [1, "09:00", "示例客户 · 小林", "试用反馈收集", "demo-he", undefined],
      [2, "08:30", "示例客户 · 阿远", "续费提醒", "demo-su", undefined],
      [4, "06:00", "示例客户 · 木木", "上门演示", "demo-tang", undefined],
      [4, "09:30", "示例客户 · 陈同学", "合同确认", "demo-bai", undefined],
    ];
    for (const [i, [d, hm, name, title, owner, editor]] of plan.entries()) {
      const id = "demo-owner-task-" + i;
      const at = `${addDays(day, d)}T${hm}:00.000Z`;
      const cid = (await customerId(name, sha256))!;
      const t: CustomerTask = {
        id, customerId: cid, at, title, feedback: i % 3 === 0 ? "虚构演示反馈" : "", nextAction: "", reminder: "both",
        completedAt: d < 0 ? at : null, deletedAt: null, createdAt: at, updatedAt: at, revision: 1, lastMutation: id,
        reminderStartAt: at, reminderGeneration: id,
        ...(owner ? { createdBy: owner, ownerUid: owner } : {}),
        ...(editor ? { updatedBy: editor } : {}),
      };
      store.data.tasks[id] = t;
    }
    // 一条在回收站里、被成员删掉的（演示「谁删的」）
    const gone = store.data.tasks["demo-owner-task-11"] as CustomerTask;
    store.data.tasks["demo-owner-task-11"] = { ...gone, deletedAt: gone.at, updatedBy: "demo-chen" };
    // 几笔成员录入的销售（演示「录入人」）
    const sales = Object.values(store.data.sales) as Sale[];
    sales.slice(0, 12).forEach((r, i) => {
      if (i % 3 === 1) store.data.sales[r.id] = { ...r, createdBy: "demo-member" };
      if (i % 3 === 2) store.data.sales[r.id] = { ...r, createdBy: "demo-song" };
    });
    // 一笔在销售回收站里、被成员删掉的（演示「谁删的」）
    const bin = sales[12];
    if (bin) store.data.sales[bin.id] = { ...bin, createdBy: "demo-member", deletedAt: `${day}T03:00:00.000Z`, deletedBy: "demo-member", updatedBy: "demo-member" };
    localStorage.setItem(key, JSON.stringify(store.data));
  }
  return {
    async call<T>(action: string, payload: unknown = {}) {
      if (!navigator.onLine)
        throw new Error("网络已断开，草稿已保留，请联网后重试");
      // e2e：模拟登录过期 / members.me 临时断网。普通演示不短路，走下面的 execute，会抛出 UNSUPPORTED_ACTION（与线上开关全关一致）
      if (action === "members.me") {
        if (sessionStorage.getItem("zhangyuge-demo-me-auth") === "1")
          throw new ApiError("登录已过期，请重新登录", "NOT_SIGNED_IN");
        const left = Number(sessionStorage.getItem("zhangyuge-demo-me-fail") || "0");
        if (left > 0) {
          sessionStorage.setItem("zhangyuge-demo-me-fail", String(left - 1));
          throw new Error("网络已断开，草稿已保留，请联网后重试");
        }
      }
      if (action.startsWith("import.") || action === "backup.restore")
        throw new Error("演示账本不接收真实数据，请连接云端后导入");
      if (role) {
        if (!store.data.members["demo-member"])
          store.data.members["demo-member"] = {
            uid: "demo-member", name: "演示成员", status: "active", inviteId: "demo",
            createdAt: "2026-11-12T00:00:00.000Z", updatedAt: "2026-11-12T00:00:00.000Z", revision: 1,
          };
        if (ownerPreview && !store.data.members["demo-song"]) await seedOwnerPreview();
        const r = (await handle(
          () => store,
          { uid: role === "member" ? "demo-member" : "demo", ownerUid: "demo", hash: sha256 },
          { action, payload },
          undefined,
          undefined,
          ownerPreview
            ? { membersEnabled: true, auditEnabled: true, scheduleOwnerEnabled: true, avatarsEnabled: true, salesActorFieldsEnabled: true, avatarStorage }
            : { membersEnabled: true, auditEnabled: true },
        )) as { ok: boolean; data?: unknown; error?: string; code?: string };
        localStorage.setItem(key, JSON.stringify(store.data));
        if (!r.ok) throw ownerPreview ? new ApiError(r.error || "操作未完成", r.code) : new Error(r.error || "操作未完成");
        return r.data as T;
      }
      const result = await execute(
        store,
        { uid: "demo", ownerUid: "demo", hash: sha256 },
        action,
        payload,
      );
      localStorage.setItem(key, JSON.stringify(store.data));
      return result as T;
    },
  };
}

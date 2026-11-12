import { MemoryStore } from "../../server/memory-store";
import { execute } from "../../server/service";
import { handle } from "../../server/handler";
import { addDays, today } from "../domain/dates";
import { NEW_CUTOFF } from "../domain/insights";
import type { Api, AppState, Product, Sale } from "../domain/model";
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
export function createDemo(role: "admin" | "member" | null = null): Api {
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
  return {
    async call<T>(action: string, payload: unknown = {}) {
      if (!navigator.onLine)
        throw new Error("网络已断开，草稿已保留，请联网后重试");
      if (action.startsWith("import.") || action === "backup.restore")
        throw new Error("演示账本不接收真实数据，请连接云端后导入");
      if (role) {
        if (!store.data.members["demo-member"])
          store.data.members["demo-member"] = {
            uid: "demo-member", name: "演示成员", status: "active", inviteId: "demo",
            createdAt: "2026-11-12T00:00:00.000Z", updatedAt: "2026-11-12T00:00:00.000Z", revision: 1,
          };
        const r = (await handle(
          () => store,
          { uid: role === "member" ? "demo-member" : "demo", ownerUid: "demo", hash: sha256 },
          { action, payload },
          undefined,
          undefined,
          { membersEnabled: true, auditEnabled: true },
        )) as { ok: boolean; data?: unknown; error?: string };
        localStorage.setItem(key, JSON.stringify(store.data));
        if (!r.ok) throw new Error(r.error || "操作未完成");
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

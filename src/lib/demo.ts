import { MemoryStore } from "../../server/memory-store";
import { execute } from "../../server/service";
import { addDays, today } from "../domain/dates";
import type { Api, AppState, Product, Sale } from "../domain/model";
export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const buffer =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const key = "zhangyuge-demo-v1";
export function createDemo(): Api {
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
  }
  return {
    async call<T>(action: string, payload: unknown = {}) {
      if (!navigator.onLine)
        throw new Error("网络已断开，草稿已保留，请联网后重试");
      if (action.startsWith("import.") || action === "backup.restore")
        throw new Error("演示账本不接收真实数据，请连接云端后导入");
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

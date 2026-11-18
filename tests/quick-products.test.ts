// 记一笔快捷商品：网页和小程序必须用同一套排序（近 3 个月利润 + 类目/名称补齐）
import { describe, expect, it } from "vitest";
import type { Product, Sale } from "../src/domain/model";
import { dashboard } from "../src/domain/finance";
import { quickProducts as webQuick, topProfitProducts } from "../src/domain/entryHelpers";
import { quickProducts as miniQuick } from "../src/miniapp/view";
import { groupProducts } from "../src/domain/catalog";

const today = "2026-11-18";

const product = (
  id: string,
  name: string,
  extra: Partial<Product> = {},
): Product => ({
  id,
  name,
  price: 0,
  cost: 0,
  active: true,
  order: 99,
  ...extra,
});

const sold = (
  productId: string,
  date: string,
  profit: number,
  extra: Partial<Sale> = {},
): Sale => ({
  id: `${productId}-${date}-${profit}-${extra.deletedAt || "ok"}`,
  productId,
  productName: extra.productName || productId,
  customer: "",
  date,
  revenue: profit,
  cost: 0,
  note: "",
  createdAt: `${date}T00:00:00.000Z`,
  updatedAt: `${date}T00:00:00.000Z`,
  deletedAt: null,
  revision: 1,
  ...extra,
});

describe("快捷商品排序（网页与小程序共用）", () => {
  it("同一份示例商品和销售，两边排出来的顺序必须一样", () => {
    // 故意打乱传入顺序，且不按 order 字段排：补齐必须走类目顺序 + 组内名称
    const products = [
      product("zeta", "Zeta 服务", { category: "其他", order: 1 }),
      product("off", "已停用高利润", { category: "其他", active: false, order: 0 }),
      product("plus", "ChatGPT Plus", { order: 8 }),
      product("arch", "已归档", { category: "其他", archivedAt: "2026-01-01", order: 2 }),
      product("claude", "Claude Pro", { order: 7 }),
      product("train", "入门培训课", { order: 3 }),
      product("alpha", "Alpha 服务", { category: "其他", order: 4 }),
      product("grok", "Grok 会员", { category: "Grok", order: 5 }),
    ];
    const sales = [
      // 本月利润：培训课最高；但近 3 个月是 Claude 最高，其次 Plus
      sold("train", "2026-11-02", 400),
      sold("claude", "2026-09-20", 800),
      sold("claude", "2026-11-01", 50),
      sold("plus", "2026-10-15", 600),
      sold("plus", "2026-11-05", 80),
      sold("off", "2026-10-03", 9_999), // 停用，不算
      sold("arch", "2026-10-03", 9_999), // 归档，不算
      sold("plus", "2026-08-17", 5_000), // 刚好在 3 个月窗外（from=2026-08-18），不算
      sold("zeta", "2026-11-01", 200, { deletedAt: "2026-11-02" }), // 已删，不算
    ];

    const web = webQuick(sales, products, today).map((p) => p.id);
    const mini = miniQuick(sales, products, today).map((p) => p.id);
    expect(mini).toEqual(web);
    // 利润：Claude 850、Plus 680、培训 400；其余按类目补齐（Grok → 其他里的 Alpha）
    expect(web).toEqual(["claude", "plus", "train", "grok", "alpha"]);

    // 对照：若仍按「本月看板前 5」排，顺序会不一样（本月利润最高的培训课会排到最前）
    const monthTop = dashboard(sales, today).products.map((p) => p.name);
    expect(monthTop[0]).toBe("train");
    expect(web[0]).toBe("claude");
  });

  it("不足 5 个有利润时，按商品清单的类目顺序和组内名称补齐，不看 order 字段，也不看传入数组顺序", () => {
    const products = [
      product("z", "Z 其他", { category: "其他", order: 0 }),
      product("c2", "Claude 乙", { order: 1 }),
      product("c1", "Claude 甲", { order: 2 }),
      product("p", "ChatGPT Plus", { order: 3 }),
    ];
    const sales = [sold("z", "2026-10-01", 100, { productName: "Z 其他" })];
    const ids = webQuick(sales, products, today).map((p) => p.id);
    expect(ids).toEqual(miniQuick(sales, products, today).map((p) => p.id));
    // 有利润的 Z 在最前；补齐顺序 = ChatGPT Plus → Claude 甲 → Claude 乙（甲/乙按名称）
    expect(ids).toEqual(["z", "p", "c1", "c2"]);
    expect(groupProducts(products).flatMap((g) => g.items.map((x) => x.id))).toEqual([
      "p",
      "c1",
      "c2",
      "z",
    ]);
  });

  it("快捷商品的前段与 topProfitProducts 一致（只含近 3 个月有利润的）", () => {
    const products = ["a", "b", "c", "d", "e", "f"].map((id) =>
      product(id, id, { category: "其他" }),
    );
    const sales = [
      sold("a", "2026-11-01", 100),
      sold("b", "2026-10-01", 500),
      sold("c", "2026-09-01", 300),
      sold("d", "2026-08-18", 200),
      sold("e", "2026-08-17", 9_999),
      sold("f", "2026-11-02", 50),
    ];
    const ranked = topProfitProducts(sales, products, today).map((p) => p.id);
    expect(ranked).toEqual(["b", "c", "d", "a", "f"]);
    expect(webQuick(sales, products, today).map((p) => p.id)).toEqual(ranked);
    expect(miniQuick(sales, products, today).map((p) => p.id)).toEqual(ranked);
  });
});

// 2026-11-10 生意手账优化：金额到元、快捷商品、日程默认时间、四色块树状图、有效动作分组
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  money,
  moneyInput,
  parseYuan,
  roundYuan,
  totals,
} from "../src/domain/finance";
import {
  addMonthsClamp,
  defaultFollowUp,
  inLunchBreak,
  topProfitProducts,
} from "../src/domain/entryHelpers";
import { buildInsights, QUADRANTS } from "../src/domain/insights";
import { PRESET_ACTIONS } from "../src/domain/actions";
import { treemap } from "../src/lib/treemap";
import type { Customer, Product, Sale } from "../src/domain/model";

const BACKUP =
  "/workspace/sales-dashboard-backup/2026-11-10_2208/章鱼哥账本备份-2026-11-10.json";
const hasBackup = existsSync(BACKUP);
const backup = hasBackup
  ? (JSON.parse(readFileSync(BACKUP, "utf8")) as {
      sales: Sale[];
      products: Product[];
      customers: Customer[];
    })
  : { sales: [], products: [], customers: [] };

describe("金额只显示到元", () => {
  it("显示不带小数，四舍五入", () => {
    expect(money(19_387_900)).toBe("193,879");
    expect(money(12_345)).toBe("123");
    expect(money(12_350)).toBe("124");
    expect(money(-12_350)).toBe("-124");
    expect(money(49)).toBe("0");
    expect(money(-49)).toBe("0");
    expect(money(0)).toBe("0");
  });
  it("合计先按分求和再取整（不是每笔先取整）", () => {
    const rows = [
      { revenue: 1_049, cost: 0 },
      { revenue: 1_049, cost: 0 },
      { revenue: 1_049, cost: 0 },
    ];
    expect(totals(rows).revenue).toBe(3_147);
    expect(money(totals(rows).revenue)).toBe("31"); // 逐笔取整会得到 30
    expect(roundYuan(3_147)).toBe(31);
  });
  it("录入只收整数元；没改动的旧角分金额原样保留", () => {
    expect(parseYuan("180")).toBe(18_000);
    expect(parseYuan("¥1,000")).toBe(100_000);
    expect(parseYuan("-5")).toBe(-500);
    expect(() => parseYuan("12.5")).toThrow("金额只填到元");
    expect(() => parseYuan("12.00")).toThrow("金额只填到元");
    expect(() => parseYuan("")).toThrow();
    expect(moneyInput(18_000)).toBe("180");
    expect(moneyInput(12_345)).toBe("123.45");
    expect(parseYuan("123.45", 12_345)).toBe(12_345);
    expect(() => parseYuan("123.46", 12_345)).toThrow();
  });
  it.skipIf(!hasBackup)(
    "备份对账：销售额 193,879 / 成本 93,610 / 利润 100,269 元",
    () => {
      const active = backup.sales.filter((s) => !s.deletedAt);
      const t = totals(active);
      expect(active.length).toBe(478);
      expect([t.revenue, t.cost, t.profit]).toEqual([
        19_387_900, 9_361_000, 10_026_900,
      ]);
      expect([money(t.revenue), money(t.cost), money(t.profit)]).toEqual([
        "193,879",
        "93,610",
        "100,269",
      ]);
    },
  );
});

describe("记一笔", () => {
  it("下个月同一天，没有这一天取月末", () => {
    expect(addMonthsClamp("2026-11-10", 1)).toBe("2026-12-10");
    expect(addMonthsClamp("2026-12-31", 1)).toBe("2027-01-31");
    expect(addMonthsClamp("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamp("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamp("2026-10-31", 1)).toBe("2026-11-30");
    expect(addMonthsClamp("2026-11-10", -3)).toBe("2026-08-10");
    expect(defaultFollowUp("2026-08-31")).toBe("2026-09-30T10:00");
  });
  it("12:30–14:00 不排日程", () => {
    expect(inLunchBreak("2026-12-10T10:00")).toBe(false);
    expect(inLunchBreak("2026-12-10T12:29")).toBe(false);
    expect(inLunchBreak("2026-12-10T12:30")).toBe(true);
    expect(inLunchBreak("2026-12-10T13:59")).toBe(true);
    expect(inLunchBreak("2026-12-10T14:00")).toBe(false);
  });
  it("快捷商品按近 3 个月利润排前 5，停用商品跳过", () => {
    const p = (id: string, active = true): Product => ({
      id,
      name: id,
      price: 0,
      cost: 0,
      active,
      order: 0,
    });
    const s = (
      productId: string,
      date: string,
      profit: number,
      deletedAt: string | null = null,
    ) =>
      ({
        id: productId + date + profit,
        productId,
        productName: productId,
        customer: "",
        date,
        revenue: profit,
        cost: 0,
        note: "",
        createdAt: "",
        updatedAt: "",
        deletedAt,
        revision: 1,
      }) as Sale;
    const products = ["a", "b", "c", "d", "e", "f"]
      .map((x) => p(x))
      .concat(p("off", false));
    const sales = [
      s("a", "2026-11-01", 100),
      s("b", "2026-10-01", 500),
      s("c", "2026-09-01", 300),
      s("d", "2026-08-10", 200),
      s("e", "2026-08-09", 9_999),
      s("f", "2026-11-02", 50),
      s("off", "2026-11-02", 9_999),
      s("a", "2026-11-03", 9_999, "2026-11-04"),
    ];
    expect(
      topProfitProducts(sales, products, "2026-11-10").map((x) => x.id),
    ).toEqual(["b", "c", "d", "a", "f"]);
  });
  it.skipIf(!hasBackup)("备份数据下的快捷商品顺序", () => {
    const names = topProfitProducts(
      backup.sales,
      backup.products,
      "2026-11-10",
    ).map((x) => x.name);
    expect(names).toEqual([
      "ChatGPT Pro 5x 1000元",
      "常规🪜A套餐",
      "ChatGPT Pro 20x 1500元",
      "常规🪜C套餐",
      "ChatGPT Plus代充180元",
    ]);
  });
});

describe("有效动作按客户色块（方案 A）", () => {
  it.skipIf(!hasBackup)(
    "李德嘉只有老客老品；李蓝天有老客老品 + 老客新品",
    () => {
      const ins = buildInsights(backup.sales, backup.customers);
      const root = (name: string) => ins.rootOf(name)!;
      expect([
        ...ins.customerQuadrants.get(root("✅李德嘉63.124.162.53"))!,
      ]).toEqual(["oldOld"]);
      expect(
        new Set(ins.customerQuadrants.get(root("✅李蓝天155.103.255.93"))),
      ).toEqual(new Set(["oldOld", "oldNew"]));
      const sizes = [...ins.customerQuadrants.values()].map((s) => s.size);
      expect(sizes.length).toBe(165);
      expect(sizes.filter((n) => n === 1).length).toBe(160);
      expect(sizes.filter((n) => n === 2).length).toBe(5);
    },
  );
  it("10 条预设动作按色块分组，每个色块都有动作", () => {
    expect(PRESET_ACTIONS).toHaveLength(10);
    for (const q of QUADRANTS)
      expect(PRESET_ACTIONS.some((a) => a.quadrant === q)).toBe(true);
  });
});

describe("树状图布局", () => {
  it("面积与客户数成正比，铺满且不越界", () => {
    const cells = treemap([
      { item: "a", value: 57 },
      { item: "b", value: 2 },
      { item: "c", value: 0 },
      { item: "d", value: 1 },
    ]);
    expect(cells.map((c) => c.item)).toEqual(["a", "b", "d"]);
    const area = cells.reduce((n, c) => n + c.w * c.h, 0);
    expect(area).toBeCloseTo(10_000, 6);
    for (const c of cells) {
      expect(c.w * c.h).toBeCloseTo((c.value / 60) * 10_000, 6);
      expect(c.x).toBeGreaterThanOrEqual(-1e-9);
      expect(c.y).toBeGreaterThanOrEqual(-1e-9);
      expect(c.x + c.w).toBeLessThanOrEqual(100 + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(100 + 1e-9);
    }
    expect(treemap([{ item: "x", value: 0 }])).toEqual([]);
  });
});

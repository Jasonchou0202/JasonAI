import { describe, expect, it } from "vitest";
import type { Bucket, Customer, CustomerTask, Dashboard, Product, Sale } from "../src/domain/model";
import { buckets, dashboard, money } from "../src/domain/finance";
import { fixedTarget, PROFIT_TARGET } from "../src/domain/profitTarget";
import { defaultFollowUp } from "../src/domain/entryHelpers";
import { dailyPendingTasks } from "../src/domain/tasks";
import {
  axisMoney,
  bucketBarsLayout,
  drawChart,
  drawProductBars,
  hitBar,
  niceScale,
  productBarsLayout,
  profitTargetLayout,
  type Ctx2D,
} from "../src/miniapp/charts";
import {
  agenda,
  beijingInput,
  beijingToUTC,
  bell,
  canEdit,
  cleanFilters,
  customerHints,
  customerRootByName,
  draftDirty,
  draftFromSale,
  draftProfit,
  freshDraft,
  freshTask,
  homeView,
  monthGrid,
  monthRange,
  pageInfo,
  pickProduct,
  prepareSave,
  presetRange,
  quickProducts,
  rankingRows,
  requestId,
  saleRow,
  scheduleDefaults,
  shiftMonth,
  taskInput,
  taskRow,
  taskStatus,
  trendSummary,
} from "../src/miniapp/view";
import { FallbackDateTimeFormat, FallbackNumberFormat, nativeIntlWorks } from "../src/miniapp/safe-intl";

const sale = (id: string, date: string, revenue: number, cost: number, extra: Partial<Sale> = {}): Sale => ({
  id,
  productId: "p1",
  productName: "Plus 会员",
  customer: "示例客户 · 小林",
  date,
  revenue,
  cost,
  note: "",
  createdAt: date + "T01:00:00.000Z",
  updatedAt: date + "T01:00:00.000Z",
  deletedAt: null,
  revision: 1,
  ...extra,
});
const task = (id: string, at: string, extra: Partial<CustomerTask> = {}): CustomerTask => ({
  id,
  customerId: "c1",
  at,
  title: "回访 " + id,
  feedback: "",
  nextAction: "",
  reminder: "both",
  completedAt: null,
  deletedAt: null,
  createdAt: at,
  updatedAt: at,
  revision: 1,
  reminderGeneration: "g",
  reminderStartAt: at,
  ...extra,
});
const product = (id: string, name: string, extra: Partial<Product> = {}): Product => ({ id, name, price: 18000, cost: 8000, active: true, order: 0, ...extra });

describe("小程序图表：坐标来自 domain，和网页同一套计算", () => {
  const months: Bucket[] = buckets(
    [sale("a", "2026-09-10", 1_000_000, 400_000), sale("b", "2026-10-10", 1_200_000, 500_000), sale("c", "2026-11-03", 900_000, 300_000)],
    "month",
    "2026-11-18",
    12,
  );
  it("每月：默认窗口是本月前 2 个月起的半年，目标虚线和网页 fixedTarget 一致", () => {
    const l = profitTargetLayout({ months, current: "2026-11", startProfit: 600_000, width: 340, height: 230 })!;
    expect(l.bars.map((b) => b.key)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(l.bars.map((b) => b.value)).toEqual([600_000, 700_000, 600_000, null, null, null]);
    expect(l.bars[2].tone).toBe("current");
    expect(l.bars[3].tone).toBe("future");
    expect(l.line).toHaveLength(3);
    // 目标点数 = 窗口里落在目标区间的月份；纵坐标按同一个刻度换算
    const target = fixedTarget(months, 600_000);
    expect(l.target).toHaveLength(6);
    const top = l.ticks[0];
    expect(top.label).toBe(axisMoney(niceScale(Math.max(...target.points.slice(0, 6).map((p) => p.value), 700_000) * 1.12).max));
    expect(l.canPrev).toBe(true);
    expect(l.canNext).toBe(true);
    expect(l.note).toContain("2027 年 12");
  });
  it("翻页到底就停；选中某月高亮", () => {
    const end = profitTargetLayout({ months, current: "2026-11", startProfit: 600_000, width: 340, height: 230, start: 999 })!;
    expect(end.bars.at(-1)!.key).toBe(PROFIT_TARGET.endMonth);
    expect(end.canNext).toBe(false);
    const sel = profitTargetLayout({ months, current: "2026-11", startProfit: 600_000, width: 340, height: 230, selected: "2026-10" })!;
    expect(sel.bars[1].tone).toBe("selected");
    expect(profitTargetLayout({ months: [], current: "2026-11", width: 340, height: 230 })).toBeNull();
  });
  it("点柱：按横坐标找最近的列，点到空白返回 null", () => {
    const l = profitTargetLayout({ months, current: "2026-11", startProfit: 600_000, width: 340, height: 230 })!;
    const b = l.bars[1];
    expect(hitBar(l, b.x + b.width / 2)!.key).toBe("2026-10");
    expect(hitBar(l, -500)).toBeNull();
  });
  it("每日：亏损用深红，负数也画；当天是珊瑚色", () => {
    const days = buckets([sale("a", "2026-11-17", 100, 300), sale("b", "2026-11-18", 500, 100)], "day", "2026-11-18", 7);
    const l = bucketBarsLayout({ buckets: days, width: 340, height: 230 });
    expect(l.bars).toHaveLength(7);
    expect(l.bars[5].tone).toBe("loss");
    expect(l.bars[6].tone).toBe("current");
    expect(l.zeroY).toBeGreaterThan(l.plot.top);
    expect(l.zeroY).toBeLessThan(l.plot.bottom);
  });
  it("商品贡献：第一名最长、亏损商品不画条", () => {
    const l = productBarsLayout(
      [
        { name: "A", profit: 1000, count: 2 },
        { name: "B", profit: 500, count: 1 },
        { name: "C", profit: -100, count: 1 },
      ],
      300,
    );
    expect(l.rows[0].width).toBeCloseTo(296);
    expect(l.rows[1].width).toBeCloseTo(148);
    expect(l.rows[2].width).toBe(0);
    expect(l.rows[0].first).toBe(true);
  });
  it("绘图只用 Canvas 2D 标准接口（小程序 canvas 2d 和浏览器都有）", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : (...a: unknown[]) => calls.push(String(k) + ":" + a.length)),
      set: (t, k, v) => ((t[k as string] = v), true),
    }) as unknown as Ctx2D;
    const l = profitTargetLayout({ months, current: "2026-11", startProfit: 600_000, width: 340, height: 230 })!;
    drawChart(ctx, l);
    drawProductBars(ctx, productBarsLayout([{ name: "很长很长很长很长很长的商品名字", profit: 1000, count: 1 }], 300), money);
    expect(new Set(calls.map((c) => c.split(":")[0]))).toEqual(
      new Set(["clearRect", "beginPath", "moveTo", "lineTo", "stroke", "fillText", "setLineDash", "arc", "fill", "fillRect"]),
    );
  });
});

describe("首页看板", () => {
  const sales = [sale("a", "2026-11-18", 18000, 8000), sale("b", "2026-11-02", 25800, 10500), sale("c", "2026-10-02", 9900, 3500)];
  const d: Dashboard = dashboard(sales, "2026-11-18");
  it("本月利润、三格统计、今天/本周/累计都来自 dashboard", () => {
    const v = homeView(d, null, "2026-11-18");
    expect(v.monthTitle).toBe("11 月利润");
    expect(v.monthProfit).toBe("¥" + money(d.month.profit));
    expect(v.stats.map((s) => s.value)).toEqual(["¥" + money(d.month.revenue), "¥" + money(d.month.cost), "2 笔"]);
    expect(v.quick.map((q) => q.label)).toEqual(["今天", "本周", "累计"]);
    expect(v.hasProducts).toBe(true);
    expect(v.ranking).toEqual([]);
  });
  it("客户排行取前 5，显示名去掉内部后缀", () => {
    const rows = rankingRows({
      items: Array.from({ length: 7 }, (_, i) => ({
        pendingTaskCount: i,
        rank: i + 1,
        customerId: "c" + i,
        name: "客户" + i,
        aliases: [],
        products: [{ name: "Plus 会员", profit: 1, count: 1 }],
        totals: { revenue: 100, cost: 0, profit: 100, count: 1 },
      })),
      unassigned: { revenue: 0, cost: 0, profit: 0, count: 0 },
      totals: { revenue: 0, cost: 0, profit: 0, count: 0 },
    });
    expect(rows).toHaveLength(5);
    expect(rows[1]).toMatchObject({ rank: 2, pending: 1, top: "Plus 会员", profit: "¥1" });
  });
  it("走势汇总：没选就是整段合计，选了某段显示那段和明细跳转范围", () => {
    const all = trendSummary(d.days);
    expect(all.from).toBe("");
    expect(all.profit).toBe("¥" + money(d.days.reduce((a, b) => a + b.profit, 0)));
    const one = trendSummary(d.months, "2026-11");
    expect(one).toMatchObject({ from: "2026-11-01", to: "2026-11-30", range: "2026-11-01 至 2026-11-30" });
  });
});

describe("记一笔", () => {
  it("新草稿是今天、带幂等请求号；请求号满足云端 recordId 规则", () => {
    const d = freshDraft("2026-11-18");
    expect(d.date).toBe("2026-11-18");
    expect(d.requestId).toMatch(/^[\w-]{1,128}$/);
    expect(requestId(() => new Uint8Array(16).fill(255))).toBe("mp-" + "ff".repeat(16));
    expect(draftDirty(d, "2026-11-18")).toBe(false);
    expect(draftDirty({ ...d, customer: "x" }, "2026-11-18")).toBe(true);
  });
  it("选商品带出默认售价和成本；没有默认价的留空", () => {
    const d = pickProduct(freshDraft("2026-11-18"), product("p1", "Plus 会员"));
    expect(d).toMatchObject({ productId: "p1", productName: "Plus 会员", revenue: "180", cost: "80" });
    expect(draftProfit(d)).toBe("¥100");
    const blank = pickProduct(d, product("p2", "其他服务", { hasDefaultPrice: false, hasDefaultCost: false }));
    expect(blank).toMatchObject({ revenue: "", cost: "" });
    expect(draftProfit({ ...d, revenue: "abc" })).toBe("¥ —");
  });
  it("编辑：历史角分原样回填，不悄悄改金额", () => {
    const d = draftFromSale(sale("s1", "2026-11-01", 18050, 8000, { paidBy: "u2" }));
    expect(d).toMatchObject({ revenue: "180.50", cost: "80", date: "2026-11-01", dateTouched: true, paidBy: "u2" });
  });
  it("快捷商品与网页共用同一函数：近 3 个月利润高的排前面，停用/归档的不出现，最多 5 个", () => {
    const ps = [product("a", "A"), product("b", "B"), product("c", "C", { active: false }), product("d", "D"), product("e", "E"), product("f", "F"), product("g", "G", { archivedAt: "x" } as Partial<Product>)];
    const sales = [
      sale("s-d", "2026-10-01", 500, 0, { productId: "d", productName: "D" }),
      sale("s-c", "2026-11-01", 800, 0, { productId: "c", productName: "C" }),
      sale("s-a", "2026-09-01", 100, 0, { productId: "a", productName: "A" }),
    ];
    expect(quickProducts(sales, ps, "2026-11-18").map((p) => p.id)).toEqual(["d", "a", "b", "e", "f"]);
  });
  it("保存：金额按分；成员付款人只在开关开时带上", () => {
    const d = { ...freshDraft("2026-11-18"), productName: "Plus 会员", customer: "小林", revenue: "180", cost: "1,080", paidBy: "u2" };
    expect(prepareSave(d).sale).toEqual({ productId: "", productName: "Plus 会员", customer: "小林", date: "2026-11-18", revenue: 18000, cost: 108000, note: "" });
    expect(prepareSave(d, { payerOn: true }).sale.paidBy).toBe("u2");
    // 和网页一样：新填的金额只到元
    expect(() => prepareSave({ ...d, revenue: "1.5" })).toThrow("只填到元");
    // 编辑历史带角分的记录，原样不动就照旧保存
    const old = sale("s", "2026-11-01", 18050, 8000);
    expect(prepareSave(draftFromSale(old), { edit: old }).sale.revenue).toBe(18050);
  });
  it("顺手建日程：默认下个月同一天 10:00（北京时间），午休和没填客户都拦住，编辑时不建", () => {
    const d = { ...freshDraft("2026-01-31"), productName: "Plus 会员", customer: " 小林 ", revenue: "1", cost: "0", schedule: true };
    const { schedule } = prepareSave(d);
    expect(defaultFollowUp("2026-01-31")).toBe("2026-02-28T10:00");
    expect(schedule).toMatchObject({ customer: "小林", at: "2026-02-28T02:00:00.000Z", title: "续费提醒：Plus 会员", reminder: "both" });
    expect(scheduleDefaults(d)).toEqual({ scheduleDate: "2026-02-28", scheduleTime: "10:00" });
    expect(() => prepareSave({ ...d, scheduleDate: "2026-02-01", scheduleTime: "13:00" })).toThrow("12:30–14:00");
    expect(() => prepareSave({ ...d, customer: " " })).toThrow("客户名称");
    expect(prepareSave(d, { edit: sale("s", "2026-01-31", 1, 0) }).schedule).toBeUndefined();
  });
  it("按客户名找档案：走到合并后的主客户；联想不含已完全一致的", () => {
    const list = [
      { id: "c1", name: "示例客户 · 小林", mergedInto: "c2" },
      { id: "c2", name: "小林（主）" },
    ] as Customer[];
    expect(customerRootByName(list, "示例客户 · 小林")).toBe("c2");
    expect(customerRootByName(list, "不存在")).toBeNull();
    expect(customerHints(["小林", "小林二号", "阿远"], "小林")).toEqual(["小林二号"]);
    expect(customerHints(["小林"], " ")).toEqual([]);
  });
});

describe("销售明细", () => {
  it("快捷时间段：今天、本周（周一起）、本月、上月（跨年）", () => {
    expect(presetRange("today", "2026-11-18")).toEqual({ from: "2026-11-18", to: "2026-11-18" });
    expect(presetRange("week", "2026-11-18")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(presetRange("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("lastMonth", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("all")).toEqual({});
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("筛选条件只带有值的项，页码至少 1", () => {
    expect(cleanFilters({ from: "2026-11-01", search: "  林 ", page: 0 })).toEqual({ from: "2026-11-01", search: "林", page: 1 });
    expect(cleanFilters({ deleted: true, productId: "p1", page: 3 })).toEqual({ deleted: true, productId: "p1", page: 3 });
  });
  it("成员只能改、删自己录入的；管理员都可以", () => {
    const mine = sale("a", "2026-11-18", 100, 0, { createdBy: "u2" });
    const old = sale("b", "2026-11-18", 100, 0);
    expect(canEdit(mine, { role: "member", uid: "u2" })).toBe(true);
    expect(canEdit(old, { role: "member", uid: "u2" })).toBe(false);
    expect(canEdit(old, { role: "admin", uid: "" })).toBe(true);
    expect(saleRow(sale("c", "2026-11-18", 100, 300), { role: "admin", uid: "" })).toMatchObject({ date: "11/18", profit: "¥-2", loss: true, editable: true, deleted: false });
  });
  it("分页文字：每页 30 条", () => {
    expect(pageInfo(61, 2)).toEqual({ pages: 3, page: 2, hasPrev: true, hasNext: true, text: "第 2 / 3 页 · 共 61 笔" });
    expect(pageInfo(0, 1)).toMatchObject({ pages: 1, hasPrev: false, hasNext: false });
  });
});

describe("客户日程和铃铛", () => {
  const now = Date.parse("2026-11-18T07:00:00.000Z"); // 北京时间 15:00
  const tasks = [
    task("t1", "2026-11-18T01:30:00.000Z"), // 今天 09:30，已过点
    task("t2", "2026-11-18T12:00:00.000Z"), // 今天 20:00
    task("t3", "2026-11-18T02:00:00.000Z", { completedAt: "x" }),
    task("t4", "2026-11-19T02:00:00.000Z"), // 明天
    task("t5", "2026-11-16T03:00:00.000Z"), // 逾期
    task("t6", "2026-11-16T03:00:00.000Z", { deletedAt: "x" }),
    task("t7", "2026-11-17T16:30:00.000Z"), // 北京时间 11-18 00:30
  ];
  it("北京时间换算（与网页 beijingToUTC 一致），无效时间报中文", () => {
    expect(beijingInput("2026-11-17T16:30:00.000Z")).toBe("2026-11-18T00:30");
    expect(beijingToUTC("2026-11-18T00:30")).toBe("2026-11-17T16:30:00.000Z");
    expect(() => beijingToUTC("2026-02-30T10:00")).toThrow("北京时间");
  });
  it("状态文字：逾期、今日、明日、已完成、已删除", () => {
    expect(tasks.map((t) => taskStatus(t, now))).toEqual(["已逾期", "今日待办", "已完成", "明日待办", "已逾期", "已删除", "已逾期"]);
    expect(taskRow(tasks[1], new Map([["c1", "示例客户 · 小林"]]), now)).toMatchObject({ time: "20:00", date: "11月18日", short: "11/18", tone: "todo" });
  });
  it("铃铛 = 网页同一个 dailyPendingTasks：今天没完成的（含已过点），不含昨天和已完成", () => {
    const b = bell(tasks, "2026-11-18");
    expect(b.rows.map((t) => t.id)).toEqual(dailyPendingTasks(tasks, "2026-11-18").map((t) => t.id));
    expect(b.rows.map((t) => t.id)).toEqual(["t7", "t1", "t2"]);
    expect(b.badge).toBe("3");
    expect(bell([], "2026-11-18").badge).toBe("");
    expect(bell(Array.from({ length: 120 }, (_, i) => task("x" + i, "2026-11-18T05:00:00.000Z")), "2026-11-18").badge).toBe("99+");
  });
  it("今日/明日/逾期分组：逾期只算未完成、未删除、今天以前的", () => {
    const a = agenda(tasks, "2026-11-18", now);
    expect(a.today.map((t) => t.id)).toEqual(["t7", "t1", "t3", "t2"]);
    expect(a.tomorrow.map((t) => t.id)).toEqual(["t4"]);
    expect(a.overdue.map((t) => t.id)).toEqual(["t5"]);
  });
  it("月历：周一开头，按北京时间计数，删除的不算，不需要的第 6 行去掉", () => {
    const g = monthGrid("2026-11", tasks, "2026-11-18", "2026-11-18");
    expect(g.title).toBe("2026 年 11 月");
    expect(g.weeks[0][0].date).toBe("2026-10-26");
    expect(g.weeks).toHaveLength(6);
    const d18 = g.weeks.flat().find((d) => d.date === "2026-11-18")!;
    expect(d18).toMatchObject({ open: 3, done: 1, today: true, selected: true, inMonth: true });
    expect(g.weeks.flat().find((d) => d.date === "2026-11-16")).toMatchObject({ open: 1, done: 0 });
    expect(monthGrid("2026-02", [], "2026-02-01").weeks).toHaveLength(5);
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("日程表单：要选客户、写标题，午休不排；时间按北京时间转 UTC", () => {
    const d = { ...freshTask("2026-11-20"), customerId: "c1", title: " 回访 " };
    expect(taskInput(d)).toEqual({ customerId: "c1", at: "2026-11-20T02:00:00.000Z", title: "回访", feedback: "", nextAction: "", reminder: "both" });
    expect(() => taskInput({ ...d, customerId: "" })).toThrow("请选择客户");
    expect(() => taskInput({ ...d, title: " " })).toThrow("标题");
    expect(() => taskInput({ ...d, time: "12:30" })).toThrow("12:30–14:00");
  });
});

describe("Intl 兜底（安卓微信 Intl 不全时）", () => {
  it("兜底日期 = 原生 sv-SE + Asia/Shanghai，跨日边界也一致", () => {
    const opts = { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" } as const;
    const native = new Intl.DateTimeFormat("sv-SE", opts);
    const fb = new FallbackDateTimeFormat("sv-SE", opts);
    for (const iso of ["2026-11-17T15:59:59.999Z", "2026-11-17T16:00:00.000Z", "2024-02-28T16:00:00.000Z", "2026-12-31T16:00:00.000Z"])
      expect(fb.format(new Date(iso))).toBe(native.format(new Date(iso)));
    const withTime = { ...opts, hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    expect(new FallbackDateTimeFormat("sv-SE", withTime).format(Date.parse("2026-11-18T01:05:00Z"))).toBe(
      new Intl.DateTimeFormat("sv-SE", withTime).format(Date.parse("2026-11-18T01:05:00Z")),
    );
  });
  it("兜底千分位 = 原生 zh-CN（整数、负数、0）", () => {
    const native = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
    const fb = new FallbackNumberFormat("zh-CN", { maximumFractionDigits: 0 });
    for (const n of [0, 7, 999, 1000, 1234567, -1234567, -5]) expect(fb.format(n)).toBe(native.format(n));
  });
  it("原生能用才用原生；缺了或算错就换兜底", () => {
    expect(nativeIntlWorks(Intl)).toBe(true);
    expect(nativeIntlWorks(undefined)).toBe(false);
    const broken = { DateTimeFormat: class { format() { return "11/18/2026"; } }, NumberFormat: Intl.NumberFormat } as unknown as typeof Intl;
    expect(nativeIntlWorks(broken)).toBe(false);
  });
});

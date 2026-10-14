import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
const hash = (text: string) =>
  "c_" + createHash("sha256").update(text).digest("hex");
const instant = "2026-10-14T04:00:00.000Z";
function fixture() {
  const sales: Record<string, any> = {},
    customers: Record<string, any> = {},
    tasks: Record<string, any> = {};
  function sale(
    name: string,
    date: string,
    profit: number,
    productName = "演示产品",
  ) {
    const id = "fixture-sale-" + Object.keys(sales).length;
    sales[id] = {
      id,
      productId: "",
      productName,
      customer: name,
      date,
      revenue: Math.max(0, profit) + 100,
      cost: Math.max(0, -profit) + 100,
      note: "虚构验收",
      createdAt: instant,
      updatedAt: instant,
      deletedAt: null,
      revision: 1,
    };
    if (name)
      customers[hash(name)] = {
        id: hash(name),
        name,
        createdAt: instant,
        updatedAt: instant,
        revision: 1,
        mergedInto: null,
      };
  }
  for (let i = 1; i <= 25; i++)
    sale(`客户${String(i).padStart(2, "0")}`, "2026-10-14", (26 - i) * 10000);
  sale("客户01", "2026-02-01", 1000, "年卡");
  sale("客户02", "2026-05-01", 2000);
  sale("客户03", "2026-08-01", 3000);
  sale("客户04", "2025-12-31", 4000);
  sale("", "2026-10-14", 500);
  sale("零利润", "2026-10-14", 0);
  sale("负利润", "2026-10-14", -100);
  for (const name of ["Faith", "faith", "✅小林63.1.2.3", "小林"])
    sale(name, "2026-10-14", 100);
  for (const [id, at, completedAt] of [
    ["late", "2026-10-14T03:00:00Z", null],
    ["soon", "2026-10-14T05:00:00Z", null],
    ["done", "2026-10-14T06:00:00Z", instant],
    ["tomorrow", "2026-10-15T05:00:00Z", null],
    ["future", "2026-10-16T05:00:00Z", null],
  ] as const)
    tasks[id] = {
      id,
      at,
      completedAt,
      customerId: hash("客户01"),
      title: `验收-${id}`,
      feedback: "",
      nextAction: "下一步计划",
      reminder: "off",
      createdAt: instant,
      updatedAt: instant,
      deletedAt: null,
      revision: 1,
    };
  return {
    sales,
    customers,
    tasks,
    products: {},
    batches: {},
    subscriptions: {},
    deliveries: {},
  };
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript((data) => {
    if (!localStorage.getItem("zhangyuge-demo-v1"))
      localStorage.setItem("zhangyuge-demo-v1", JSON.stringify(data));
    sessionStorage.setItem("zhangyuge-demo", "true");
  }, fixture());
  await page.goto("./#/dashboard");
  await expect(
    page.getByRole("heading", { name: "核心客户", exact: true }),
  ).toBeVisible();
});
const ranking = (page: Page) => page.locator(".customer-ranking");

test("all-time top twenty, sorting, expand, search and history link", async ({
  page,
}) => {
  const panel = ranking(page),
    rows = panel.locator(".customer-ranks > li");
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toContainText("客户01");
  expect(await rows.locator(".customer-rank-number").allTextContents()).toEqual(
    Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0")),
  );
  const values = (await rows.locator(".money").allTextContents()).map((v) =>
    Number(v.replaceAll(",", "")),
  );
  expect(values).toEqual([...values].sort((a, b) => b - a));
  await panel.getByRole("button", { name: /展开全部/ }).click();
  await expect(rows).toHaveCount(31);
  await expect(panel).not.toContainText("✅");
  await panel.getByRole("searchbox").fill("年卡");
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole("button").click();
  await expect(page).toHaveURL(/month=all/);
  await expect(page.getByText("全部历史", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "客户日程", exact: true }),
  ).toBeVisible();
});
test("month, quarter, half and year include the correct range and shift across year", async ({
  page,
}) => {
  const panel = ranking(page);
  for (const [tab, label] of [
    ["月", "月利润"],
    ["季", "季利润"],
    ["半年", "半年利润"],
    ["年", "年利润"],
  ]) {
    await panel.getByRole("tab", { name: tab, exact: true }).click();
    await expect(panel.locator(".customer-summary").first()).toContainText(
      label,
    );
    await expect(panel.getByRole("alert")).toHaveCount(0);
  }
  await panel.getByRole("tab", { name: "季", exact: true }).click();
  await expect(panel).toContainText("2026年Q4（10-12月）");
  await panel.getByRole("button", { name: "排行下一周期" }).click();
  await expect(panel).toContainText("2027年Q1（1-3月）");
  await expect(panel).toContainText("这个周期还没有客户成交");
  await panel.getByRole("tab", { name: "月", exact: true }).click();
  await panel.getByRole("textbox", { name: "排行月份" }).fill("2026-02");
  await expect(panel.locator(".customer-ranks > li")).toHaveCount(1);
  await panel.locator(".customer-rank-link").click();
  await expect(page).toHaveURL(/month=2026-02/);
});
test("suggestions merge after preview and can be undone without changing sale text", async ({
  page,
}) => {
  await page.goto("./#/settings");
  const suggestions = page.locator(".customer-suggestions");
  await expect(suggestions.locator(".suggestion-card")).toHaveCount(2);
  await suggestions
    .getByRole("button", { name: "全部合并", exact: true })
    .click();
  await suggestions
    .getByRole("button", { name: "已预览，确认全部合并" })
    .click();
  await expect(suggestions).toHaveCount(0);
  await expect(page.locator(".customer-alias-list > li")).toHaveCount(2);
  const raw = await page.evaluate(
    () => JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!).sales,
  );
  expect(
    Object.values(raw).some((s: any) => s.customer === "✅小林63.1.2.3"),
  ).toBe(true);
  await page
    .locator(".customer-alias-list > li")
    .first()
    .getByRole("button", { name: "解除合并" })
    .click();
  await expect(page.locator(".suggestion-card")).toHaveCount(1);
});
test("IP-only batch merge leaves case suggestions for manual review", async ({
  page,
}) => {
  await page.goto("./#/settings");
  const suggestions = page.locator(".customer-suggestions");
  await expect(suggestions.locator(".suggestion-card")).toHaveCount(2);
  await suggestions
    .getByRole("button", { name: "仅合并 IP/符号变体", exact: true })
    .click();
  await expect(suggestions).toContainText("大小写建议保持不变");
  await suggestions
    .getByRole("button", { name: "已预览，确认合并 IP/符号变体", exact: true })
    .click();
  await expect(suggestions.locator(".suggestion-card")).toHaveCount(1);
  await expect(suggestions.locator(".suggestion-card")).toContainText(
    "仅大小写不同",
  );
  await expect(page.locator(".customer-alias-list > li")).toHaveCount(1);
});
test("calendar mixed colours, complete, reopen, schedule next, delete, restore and purge", async ({
  page,
}) => {
  await page.goto("./#/calendar");
  await expect(
    page.getByRole("button", {
      name: "2026-10-14，已完成1，今明未到1，逾期或待办1，共3条",
      exact: true,
    }),
  ).toBeVisible();
  const history = page.locator(".customer-history");
  const card = history.locator("article").filter({
    has: page.getByRole("heading", { name: "验收-soon", exact: true }),
  });
  await expect(card).toHaveClass(/task-urgent/);
  await card.getByRole("button", { name: "完成", exact: true }).click();
  await expect(card).toHaveClass(/task-complete/);
  await card.getByRole("button", { name: "重开", exact: true }).click();
  await expect(card).toHaveClass(/task-urgent/);
  await card.getByRole("button", { name: "安排下一次" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("要做什么")).toHaveValue("下一步计划");
  await modal.getByLabel("要做什么").fill("下一次验收");
  await modal.getByLabel(/跟进时间/).fill("2026-10-15T15:00");
  await modal.getByLabel("提醒", { exact: true }).selectOption("off");
  await modal.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await card.getByRole("button", { name: "删除", exact: true }).click();
  await history.getByRole("button", { name: "回收站", exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(card).toHaveCount(0);
  await history.getByRole("button", { name: "全部", exact: true }).click();
  await card.getByRole("button", { name: "删除", exact: true }).click();
  await history.getByRole("button", { name: "回收站", exact: true }).click();
  await card.getByRole("button", { name: "彻底删除", exact: true }).click();
  await card
    .getByRole("button", { name: "确认彻底删除（不可恢复）", exact: true })
    .click();
  await expect(card).toHaveCount(0);
});
test("375px navigation, period controls and unsaved draft survive an offline refresh", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByRole("navigation", { name: "手机导航" }).getByRole("button"),
  ).toHaveCount(4);
  await ranking(page).getByRole("tab", { name: "半年", exact: true }).click();
  await expect(ranking(page)).toContainText("下半年");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("navigation", { name: "手机导航" })
    .getByRole("button", { name: "记一笔" })
    .click();
  await page.getByLabel(/商品名称/).fill("未保存草稿");
  await page.getByLabel("客户名称", { exact: false }).fill("测试客户");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel(/商品名称/)).toHaveValue("未保存草稿");
  await expect(
    page.getByText("未保存 · 草稿已保留在本机", { exact: true }),
  ).toBeVisible();
  const cached = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map((r) => r.url),
        ),
      )
    ).flat(),
  );
  expect(cached.length).toBeGreaterThan(2);
  expect(
    cached.every(
      (url) =>
        new URL(url).pathname.startsWith("/JasonAI/") && !new URL(url).search,
    ),
  ).toBe(true);
});
test("offline save keeps the draft and retry creates exactly one sale", async ({
  page,
  context,
}) => {
  await page.goto("./#/entry");
  await page.getByLabel(/商品名称/).fill("断网验收");
  await page.getByLabel(/销售额/).fill("12.34");
  await page.getByLabel(/成本 \/ 出资/).fill("2.01");
  await context.setOffline(true);
  await page.getByRole("button", { name: "保存这笔", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("网络已断开");
  await context.setOffline(false);
  await page.getByRole("button", { name: "保存这笔", exact: true }).dblclick();
  await expect(page).toHaveURL(/dashboard/);
  const rows = await page.evaluate(() =>
    Object.values(
      JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!).sales,
    ).filter((s: any) => s.productName === "断网验收"),
  );
  expect(rows).toHaveLength(1);
  expect((rows[0] as any).revenue - (rows[0] as any).cost).toBe(1033);
});

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
    products: {
      "preset-claude": {
        id: "preset-claude",
        name: "Claude Max 5x",
        price: 12000,
        cost: 3000,
        active: true,
        order: 0,
      },
      "preset-chatgpt": {
        id: "preset-chatgpt",
        name: "ChatGPT Plus",
        price: 18000,
        cost: 9000,
        active: true,
        order: 1,
      },
      "acceptance-product": {
        id: "acceptance-product",
        name: "虚构导入验收商品",
        price: 100,
        cost: 0,
        active: true,
        order: 2,
      },
    },
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

test("daily reminder button counts today's open tasks and opens the correct schedule", async ({
  page,
}) => {
  const bell = page.getByRole("button", {
    name: "日常提醒，今日 2 条待办",
    exact: true,
  });
  await expect(bell).toBeVisible();
  await bell.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "今日待办", exact: true }),
  ).toBeVisible();
  const list = dialog.getByRole("list", { name: "今日未完成日程" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("11:00");
  await expect(list).toContainText("13:00");
  await expect(list).toContainText("客户01");
  await expect(list).not.toContainText("验收-done");
  await list.getByRole("button").filter({ hasText: "验收-soon" }).click();
  const taskDialog = page.getByRole("dialog");
  await expect(
    taskDialog.getByRole("heading", { name: "跟进日程", exact: true }),
  ).toBeVisible();
  await taskDialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "日常提醒，今日 1 条待办", exact: true }),
  ).toBeVisible();
  await taskDialog.getByRole("button", { name: "重开", exact: true }).click();
  await expect(bell).toBeVisible();
});

test("daily reminders handle a new Beijing day, zero items, offline failure and mobile width", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByRole("button", { name: "日常提醒，今日 2 条待办", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.clock.setFixedTime(new Date("2026-10-16T16:00:01Z"));
  await page.getByRole("button", { name: /日常提醒/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("2026-10-17");
  await expect(dialog).toContainText("今天没有未完成事项");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "日常提醒，今日 0 条待办", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: /日常提醒/ }).click();
  await expect(dialog).toContainText("暂时无法更新今日待办");
  await expect(dialog).not.toContainText("今天没有未完成事项");
  await expect(
    dialog.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(dialog).toContainText("今天没有未完成事项");
  await dialog.getByRole("button", { name: "刷新待办", exact: true }).click();
  await expect(dialog).toContainText("今天没有未完成事项");
});

test("add product selects it, preserves the sale draft on cancel, and keeps manual category and empty defaults", async ({
  page,
}) => {
  await page.goto("./#/entry");
  const productInput = page.getByLabel(/商品名称/);
  const addProduct = page.getByRole("button", {
    name: "新增商品",
    exact: true,
  });
  await page.getByRole("button", { name: "ChatGPT Plus", exact: true }).click();
  await page.getByLabel("客户名称", { exact: false }).fill("原销售客户");
  await addProduct.click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("商品名称", { exact: true }).fill("尚未保存商品");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel(/商品名称/)).toHaveValue("ChatGPT Plus");
  await expect(page.getByLabel(/销售额/)).toHaveValue("180.00");
  await addProduct.click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("商品名称", { exact: true }).fill("ChatGPT 新服务");
  await expect(dialog.getByLabel("商品类目")).toHaveValue("ChatGPT");
  await dialog.getByLabel("商品类目").selectOption("培训与教程");
  await dialog
    .getByLabel("商品名称", { exact: true })
    .fill("ChatGPT 新服务年卡");
  await expect(dialog.getByLabel("商品类目")).toHaveValue("培训与教程");
  await dialog.getByLabel("常用成本（选填）").fill("0");
  await dialog.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(productInput).toHaveValue("ChatGPT 新服务年卡");
  await expect(page.getByLabel(/销售额/)).toHaveValue("");
  await expect(page.getByLabel(/成本 \/ 出资/)).toHaveValue("0.00");
  await expect(page.getByLabel("客户名称", { exact: false })).toHaveValue(
    "原销售客户",
  );
  await page.reload();
  await expect(productInput).toHaveValue("ChatGPT 新服务年卡");
  await page.goto("./#/settings");
  const directory = page.locator(".catalog-directory");
  await directory
    .getByRole("button", { name: "所有商品", exact: true })
    .click();
  await expect(
    directory
      .locator(".catalog-product-group")
      .filter({ hasText: "培训与教程" }),
  ).toContainText("ChatGPT 新服务年卡");
  const row = page
    .locator(".product-table-row")
    .filter({ hasText: "ChatGPT 新服务年卡" });
  await expect(row).toContainText("未设置");
  await row.getByRole("button").click();
  await expect(page.getByRole("dialog").getByLabel("商品类目")).toHaveValue(
    "培训与教程",
  );
});

test("product offline retry survives modal close and adds once; existing names use their original defaults", async ({
  page,
  context,
}) => {
  await page.goto("./#/entry");
  const addProduct = page.getByRole("button", {
    name: "新增商品",
    exact: true,
  });
  await addProduct.click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("商品名称", { exact: true }).fill("断网商品");
  await context.setOffline(true);
  await dialog.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("网络已断开");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await context.setOffline(false);
  await addProduct.click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("商品名称", { exact: true })).toHaveValue(
    "断网商品",
  );
  await dialog
    .getByRole("button", { name: "重试保存商品", exact: true })
    .dblclick();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(
      () =>
        Object.values(
          JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!).products,
        ).filter((p: any) => p.name === "断网商品").length,
    ),
  ).toBe(1);
  await addProduct.click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("商品名称", { exact: true }).fill(" ChatGPT Plus ");
  await dialog.getByLabel("常用售价（选填）").fill("999");
  await dialog.getByRole("button", { name: "保存商品", exact: true }).click();
  await expect(page.getByLabel(/销售额/)).toHaveValue("180.00");
});

test("ranking badges count future and overdue tasks, change after completion, and handle 99+ on mobile", async ({
  page,
}) => {
  const first = ranking(page).locator(".customer-ranks > li").first();
  await expect(first.getByRole("status")).toHaveText("4");
  await ranking(page).getByRole("tab", { name: "月", exact: true }).click();
  await expect(first.getByRole("status")).toHaveText("4");
  await page.goto("./#/calendar");
  await page
    .locator(".customer-today article")
    .filter({ hasText: "验收-late" })
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await page.getByRole("button", { name: "生意看板", exact: true }).click();
  await expect(first.getByRole("status")).toHaveText("3");
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!);
    for (let i = 0; i < 100; i++)
      data.tasks["large-" + i] = { ...data.tasks.future, id: "large-" + i };
    const original = data.customers[data.tasks.future.customerId];
    original.name = "这是一个用于验收长名称与待办角标是否重叠的客户名称";
    for (const sale of Object.values(data.sales) as any[])
      if (sale.customer === "客户01") sale.customer = original.name;
    localStorage.setItem("zhangyuge-demo-v1", JSON.stringify(data));
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(first.getByRole("status")).toHaveText("99+");
  await expect(first.getByRole("status")).toHaveAttribute(
    "aria-label",
    "103 条未完成日程",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

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
    page
      .getByRole("group", { name: "成交时间范围" })
      .getByRole("button", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
test("sales customer search opens schedule management", async ({ page }) => {
  await page.goto("./#/details");
  await page.getByRole("textbox", { name: "搜索销售记录" }).fill("客户01");
  const customerLinks = page.getByLabel("查询客户的日程管理");
  await expect(customerLinks).toContainText("客户01 · 日程管理");
  await customerLinks
    .getByRole("button", { name: "客户01 · 日程管理", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`customer\\?id=${hash("客户01")}&month=all`),
  );
  await expect(page.getByText("全部历史", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /今日日程/ })).toBeVisible();
});
test("calendar supports both name search and dropdown, and prioritizes today's tasks", async ({
  page,
}) => {
  await page.goto("./#/calendar");
  const todayPanel = page.locator(".customer-today");
  await expect(todayPanel.locator("article")).toHaveCount(3);
  await page
    .getByRole("searchbox", { name: "输入客户名字查找日程" })
    .fill("客户02");
  await expect(todayPanel).toContainText("今天没有日程");
  await page
    .getByRole("combobox", { name: "按客户查看", exact: true })
    .selectOption(hash("客户01"));
  await expect(
    page.getByRole("searchbox", { name: "输入客户名字查找日程" }),
  ).toHaveValue("");
  await expect(todayPanel.locator("article")).toHaveCount(3);
  const history = page.locator(".customer-history .customer-task-list article");
  await expect(history.nth(0)).toContainText("验收-late");
  await expect(history.nth(2)).toContainText("验收-done");
  await expect(history.nth(3)).toContainText("验收-tomorrow");
});
test("full directories, quick product tags and recoverable acceptance cleanup", async ({
  page,
}) => {
  await page.goto("./#/settings");
  const directory = page.locator(".catalog-directory");
  await expect(
    directory.getByRole("button", { name: "日程管理", exact: true }).first(),
  ).toBeVisible();
  await directory
    .getByRole("button", { name: "所有商品", exact: true })
    .click();
  await expect(directory).toContainText("年卡");
  await expect(
    directory.locator(".catalog-product-group h3").first(),
  ).toContainText("ChatGPT");
  const cleanup = page.locator(".catalog-cleanup");
  await cleanup
    .getByRole("button", { name: "清理验收客户与商品", exact: true })
    .click();
  await expect(cleanup).toContainText("没有需要清理");
  await expect(directory).not.toContainText("虚构导入验收商品");
  await cleanup.getByText("已删除清单（1 项）", { exact: true }).click();
  await cleanup.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(directory).toContainText("虚构导入验收商品");
  await page.goto("./#/entry");
  const tag = page.getByRole("button", { name: "ChatGPT Plus", exact: true });
  await tag.click();
  await expect(tag).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/商品名称/)).toHaveValue("ChatGPT Plus");
  await expect(page.getByLabel(/销售额/)).toHaveValue("180.00");
  await page.getByLabel(/商品名称/).fill("新手动商品");
  await expect(tag).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel(/商品名称/).fill("Claude Max 5x");
  await expect(page.getByLabel(/销售额/)).toHaveValue("120.00");
});
test("quick entry: tag, customer, save stores the same sale fields; recent product first; date collapsed", async ({
  page,
}) => {
  await page.goto("./#/entry");
  const tags = page
    .getByRole("group", { name: /常用商品/ })
    .getByRole("button");
  await expect(tags.first()).toHaveText("ChatGPT Plus");
  await page
    .getByRole("button", { name: "Claude Max 5x", exact: true })
    .click();
  await page.getByLabel("客户名称", { exact: false }).fill("快速录入客户");
  const dateToggle = page.getByRole("button", {
    name: "成交日期：今天，点击修改",
    exact: true,
  });
  await expect(dateToggle).toBeVisible();
  // 让这笔的创建时间晚于夹具数据，才能验证“最近卖过的排前面”
  await page.clock.setFixedTime(new Date("2026-10-14T05:00:00.000Z"));
  await page.getByRole("button", { name: "保存这笔", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  const rows = await page.evaluate(() =>
    Object.values(
      JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!).sales,
    ).filter((s: any) => s.customer === "快速录入客户"),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    productId: "preset-claude",
    productName: "Claude Max 5x",
    customer: "快速录入客户",
    date: "2026-10-14",
    revenue: 12000,
    cost: 3000,
    note: "",
  });
  await page.goto("./#/entry");
  await expect(tags.first()).toHaveText("Claude Max 5x");
  await page
    .getByRole("button", { name: "成交日期：今天，点击修改", exact: true })
    .click();
  await page.getByLabel(/成交日期/).fill("2026-10-12");
  await expect(page.getByLabel(/成交日期/)).toHaveValue("2026-10-12");
});
test("mobile entry keeps the save bar visible above the bottom navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./#/entry");
  const save = page.getByRole("button", { name: "保存这笔", exact: true });
  await expect(save).toBeInViewport();
  const [saveBox, navBox] = await Promise.all([
    save.boundingBox(),
    page.getByRole("navigation", { name: "手机导航" }).boundingBox(),
  ]);
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(navBox!.y);
  // 最后一个输入框（备注）获得焦点时，不能被固定保存栏挡住
  const bar = page.locator(".entry-form .form-actions");
  for (const field of ["#note", "#cost", "#customer"]) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator(field).focus();
    const [fieldBox, barBox] = await Promise.all([
      page.locator(field).boundingBox(),
      bar.boundingBox(),
    ]);
    expect(fieldBox!.y + fieldBox!.height).toBeLessThanOrEqual(barBox!.y);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const [noteBox, barEnd] = await Promise.all([
    page.locator("#note").boundingBox(),
    bar.boundingBox(),
  ]);
  expect(noteBox!.y + noteBox!.height).toBeLessThanOrEqual(barEnd!.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("customer detail defaults to this month, switches range, groups by month and pages 20 at a time", async ({
  page,
}) => {
  // 先切到客户页再写入测试数据，避免演示账本的下一次保存覆盖它
  await page.goto(`./#/customer?id=${hash("客户05")}`);
  await expect(page.getByRole("heading", { name: "客户05" })).toBeVisible();
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!);
    const base = Object.values(data.sales).find(
      (s: any) => s.customer === "客户05",
    ) as any;
    for (let i = 0; i < 45; i++) {
      const month = ["2026-10", "2026-09", "2026-07"][i % 3];
      const id = "paging-" + i;
      data.sales[id] = {
        ...base,
        id,
        date: `${month}-${String(1 + (i % 9)).padStart(2, "0")}`,
        revenue: 1000,
        cost: 400,
      };
    }
    localStorage.setItem("zhangyuge-demo-v1", JSON.stringify(data));
  });
  await page.reload();
  const period = page.getByRole("group", { name: "成交时间范围" });
  const rows = page.locator(".customer-sales .customer-sale");
  await expect(
    period.getByRole("button", { name: "本月", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".customer-period-text")).toHaveText(
    "2026 年 10 月",
  );
  await expect(page.locator(".customer-stats")).toContainText("16");
  await expect(rows).toHaveCount(16);
  await period.getByRole("button", { name: "近 3 个月", exact: true }).click();
  await expect(rows).toHaveCount(20);
  await expect(page.locator(".customer-month-title")).toHaveCount(2);
  await expect(page.locator(".customer-month-title").nth(1)).toContainText(
    "2026 年 9 月",
  );
  await expect(page.locator(".customer-month-title").nth(1)).toContainText(
    "15 笔",
  );
  const count = page.locator(".customer-paging-count");
  await expect(count).toHaveText("已显示 20 / 31");
  await page.getByRole("button", { name: /查看更多（还有 11 笔）/ }).click();
  await expect(rows).toHaveCount(31);
  await expect(count).toHaveText("已显示 31 / 31");
  await expect(page.getByRole("button", { name: /查看更多/ })).toHaveCount(0);
  await period.getByRole("button", { name: "全部", exact: true }).click();
  await expect(rows).toHaveCount(20);
  await expect(page.locator(".customer-stats")).toContainText("46");
  await expect(count).toHaveText("已显示 20 / 46");
  await page.getByRole("button", { name: "客户销售上个月" }).waitFor({
    state: "detached",
  });
  await period.getByRole("button", { name: "本月", exact: true }).click();
  await page.getByRole("button", { name: "客户销售上个月" }).click();
  await expect(page.locator(".customer-period-text")).toHaveText(
    "2026 年 9 月",
  );
  await expect(rows).toHaveCount(15);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("a merged alias link with month=all opens the owner's full history", async ({
  page,
}) => {
  await page.goto("./#/settings");
  const suggestions = page.locator(".customer-suggestions");
  await suggestions
    .getByRole("button", { name: "全部合并", exact: true })
    .click();
  await suggestions
    .getByRole("button", { name: "已预览，确认全部合并" })
    .click();
  await expect(suggestions).toHaveCount(0);
  await page.goto(`./#/customer?id=${hash("✅小林63.1.2.3")}&month=all`);
  await expect(
    page.getByRole("heading", { name: "小林", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("全部历史", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "成交时间范围" })
      .getByRole("button", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".customer-stats")).toContainText("2");
});
test("customer detail without a month falls back with a hint and keeps the view after refresh", async ({
  page,
}) => {
  await page.goto("./#/details");
  await expect(page.getByRole("heading", { name: "销售明细" })).toBeVisible();
  await page.evaluate(
    ([recentId, oldId]) => {
      const data = JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!);
      const base = Object.values(data.sales)[0] as any;
      const add = (name: string, cid: string, date: string, i: number) => {
        data.sales["fallback-" + i] = {
          ...base,
          id: "fallback-" + i,
          customer: name,
          date,
        };
        data.customers[cid] = {
          id: cid,
          name,
          createdAt: base.createdAt,
          updatedAt: base.createdAt,
          revision: 1,
          mergedInto: null,
        };
      };
      add("回落客户", recentId, "2026-09-05", 1);
      add("回落客户", recentId, "2026-03-05", 2);
      add("久远客户", oldId, "2025-05-01", 3);
      localStorage.setItem("zhangyuge-demo-v1", JSON.stringify(data));
    },
    [hash("回落客户"), hash("久远客户")],
  );
  await page.reload();
  await page.goto(`./#/customer?id=${hash("回落客户")}`);
  const period = page.getByRole("group", { name: "成交时间范围" });
  const hint = page.locator(".customer-view-hint");
  await expect(hint).toHaveText("本月暂无成交，已为你显示近 3 个月");
  await expect(
    period.getByRole("button", { name: "近 3 个月", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".customer-sales .customer-sale")).toHaveCount(1);
  await page.getByRole("button", { name: "刷新账本" }).click();
  await expect(
    period.getByRole("button", { name: "近 3 个月", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toHaveText("本月暂无成交，已为你显示近 3 个月");
  await period.getByRole("button", { name: "全部", exact: true }).click();
  await expect(hint).toHaveCount(0);
  await page.getByRole("button", { name: "刷新账本" }).click();
  await expect(
    period.getByRole("button", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".customer-sales .customer-sale")).toHaveCount(2);
  await page.goto(`./#/customer?id=${hash("久远客户")}`);
  await expect(hint).toHaveText("本月和近 3 个月暂无成交，已为你显示全部");
  await expect(
    period.getByRole("button", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("dashboard hero shows this month's profit, links to details, and the customer header shows total profit", async ({
  page,
}) => {
  const hero = page.locator(".dash-hero");
  await expect(hero.getByRole("heading", { name: /生意概览/ })).toBeVisible();
  await expect(hero.locator("img")).toHaveAttribute("alt", "");
  const stats = page.getByRole("region", { name: "本月账本" });
  await expect(stats).toContainText("本月销售额");
  await expect(stats).toContainText("本月成本");
  await expect(stats).toContainText("本月成交");
  await expect(page.locator(".bar-column.last .bar-tip")).toBeVisible();
  const total = ranking(page).getByRole("button", { name: /^累计利润/ });
  await expect(total).toBeVisible();
  await hero.getByRole("button", { name: /^本月利润/ }).click();
  await expect(page.getByRole("heading", { name: "销售明细" })).toBeVisible();
  await page.goto("./#/dashboard");
  await ranking(page)
    .getByRole("button", { name: /^累计利润/ })
    .click();
  await expect(page.getByRole("heading", { name: "销售明细" })).toBeVisible();
});
test("sales rows open the editor and keep schedule, edit and delete in a ⋯ menu", async ({
  page,
}) => {
  await page.goto("./#/details");
  const first = page.locator(".detail-row").first();
  const menu = first.getByRole("button", { name: /^更多操作/ });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const items = first.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await expect(first.getByRole("menuitem", { name: /^编辑/ })).toBeVisible();
  await expect(first.getByRole("menuitem", { name: /^删除/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(first.getByRole("menu")).toHaveCount(0);
  await expect(menu).toBeFocused();
  await menu.click();
  await first.getByRole("menuitem", { name: /^删除/ }).click();
  await expect(page.getByRole("dialog")).toContainText("移入回收站？");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await first.locator(".detail-open").click();
  await expect(page.getByRole("heading", { name: "编辑销售" })).toBeVisible();
});
test("the hero compares this month with the same days of last month", async ({
  page,
}) => {
  await expect(page.locator(".dash-growth")).toHaveCount(0);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!);
    const add = (id: string, date: string, profit: number) => {
      data.sales[id] = {
        ...data.sales["fixture-sale-0"],
        id,
        customer: "客户01",
        date,
        revenue: profit + 100,
        cost: 100,
      };
    };
    add("same-period", "2026-09-10", 100000);
    add("after-same-day", "2026-09-20", 99900000);
    localStorage.setItem("zhangyuge-demo-v1", JSON.stringify(data));
  });
  await page.reload();
  const label = await page
    .locator(".dash-hero-number")
    .getAttribute("aria-label");
  const month = Math.round(
    Number(/本月利润 ([\d,.\-−]+) 元/.exec(label!)![1].replace(/[,]/g, "")) *
      100,
  );
  const pct = Math.round(((month - 100000) / 100000) * 100);
  await expect(page.locator(".dash-growth")).toHaveText(
    `比上月同期 ${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%`,
  );
});
test("the ⋯ menu stays on top, closes when Tab leaves it and returns focus sensibly", async ({
  page,
}) => {
  await page.goto("./#/details");
  const first = page.locator(".detail-row").first();
  const menu = first.getByRole("button", { name: /^更多操作/ });
  await menu.click();
  const list = first.getByRole("menu");
  await list.scrollIntoViewIfNeeded();
  // 菜单下沿不被下一行盖住
  const onTop = await list.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.right - 12, r.bottom - 3);
    return !!hit && el.contains(hit);
  });
  expect(onTop).toBe(true);
  // Tab 离开菜单后收起
  await first.getByRole("menuitem").last().focus();
  await page.keyboard.press("Tab");
  await expect(first.getByRole("menu")).toHaveCount(0);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  // 选「删除」后取消：焦点回到 ⋯
  await menu.click();
  await first.getByRole("menuitem", { name: /^删除/ }).press("Enter");
  await expect(page.getByRole("dialog")).toContainText("移入回收站？");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(menu).toBeFocused();
  // 选「编辑」：焦点交给编辑页标题
  await menu.click();
  await first.getByRole("menuitem", { name: /^编辑/ }).press("Enter");
  await expect(page.getByRole("heading", { name: "编辑销售" })).toBeFocused();
});
test("skip link, demo notice landmark and a single h1 on every page", async ({
  page,
}) => {
  const notice = page.getByRole("complementary", { name: "演示提示" });
  await expect(notice).toHaveText(
    /^演示数据，只存本机，请勿录入真实客户\s*·\s*退出$/,
  );
  await expect(
    notice.getByRole("button", { name: "退出演示", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("button", { name: "跳到主要内容" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  for (const route of [
    "dashboard",
    "entry",
    "details",
    "calendar",
    "settings",
  ]) {
    await page.goto(`./#/${route}`);
    await expect(page.locator("main h1")).toHaveCount(1);
  }
  await page.goto("./#/dashboard");
  await ranking(page).locator(".customer-rank-link").first().click();
  await expect(page.getByRole("heading", { name: "客户日程" })).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("definition").first()).toBeVisible();
  await expect(page.locator(".hero-figures")).toContainText("累计利润");
});
test.describe("small phones", () => {
  test.use({ viewport: { width: 375, height: 667 }, isMobile: true });
  test("the demo notice shows the full warning without hover and fits the screen", async ({
    page,
  }) => {
    const notice = page.getByRole("complementary", { name: "演示提示" });
    const text = notice.getByText("演示数据，只存本机，请勿录入真实客户", {
      exact: true,
    });
    await expect(text).toBeVisible();
    await expect(
      notice.getByRole("button", { name: "退出演示", exact: true }),
    ).toBeVisible();
    const box = (await notice.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(
      await notice.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  });
});
test.describe("touch screens", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("tapping a trend bar shows its amount first, the second tap opens the details", async ({
    page,
  }) => {
    const bars = page.locator(".dash-chart .bar-column");
    const target = bars.nth((await bars.count()) - 2);
    const label = (await target.getAttribute("aria-label"))!;
    const from = label.slice(0, 10);
    await target.tap();
    await expect(page).toHaveURL(/#\/dashboard|\/JasonAI\/$/);
    await expect(page.locator(".chart-summary")).toContainText(from);
    await expect(target).toHaveClass(/armed/);
    await expect(
      page.getByRole("button", { name: "查看这段明细" }),
    ).toBeVisible();
    await target.tap();
    await expect(page.getByRole("heading", { name: "销售明细" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`from=${from}`));
  });
});
test("with a mouse, one click on a trend bar still opens the details", async ({
  page,
}) => {
  await page.locator(".dash-chart .bar-column").last().click();
  await expect(page.getByRole("heading", { name: "销售明细" })).toBeVisible();
});
test.describe("after a new deploy removes old lazy chunks", () => {
  test.use({ serviceWorkers: "block" });
  test("a missing schedule chunk reloads once, then shows the update notice instead of a blank page", async ({
    page,
  }) => {
    const chunk = /\/assets\/Calendar-[^/]+\.js(\?.*)?$/;
    await page.route(chunk, (route) =>
      route.fulfill({ status: 404, contentType: "text/plain", body: "" }),
    );
    // 每次打开文档都记一次数（存在 sessionStorage，刷新后仍在），不依赖 load 事件
    await page.addInitScript(() => {
      const n = Number(sessionStorage.getItem("e2e-doc-loads") || 0);
      sessionStorage.setItem("e2e-doc-loads", String(n + 1));
    });
    const loads = () =>
      page
        .evaluate(() => Number(sessionStorage.getItem("e2e-doc-loads") || 0))
        .catch(() => -1);
    // 重新打开页面：空闲预取拿不到日程文件，会自动刷新一次，且只刷新一次。
    // 自动刷新会打断这次 reload，所以只等到开始提交即可
    await page.reload({ waitUntil: "commit" });
    await expect.poll(loads, { timeout: 20000 }).toBe(2);
    await page.waitForLoadState("load");
    await expect(
      page.getByRole("heading", { name: "核心客户", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .evaluate(() => sessionStorage.getItem("zhangyuge-chunk-reload-at"))
          .catch(() => null),
      )
      .not.toBeNull();
    // 再等一会儿，确认没有第二次自动刷新
    await page.waitForTimeout(2000);
    expect(await loads()).toBe(2);
    await page.goto("./#/calendar");
    const button = page.getByRole("button", {
      name: "页面有更新，点此刷新",
      exact: true,
    });
    await expect(button).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("页面有更新");
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.locator(".app-shell")).toBeVisible();
    // 新版本文件可以拿到后，点刷新就能正常打开
    await page.unroute(chunk);
    await button.click();
    await expect(
      page.getByRole("heading", { name: "跟进日历", level: 1 }),
    ).toBeVisible();
  });
});
test.describe("first screen on a 1280×800 laptop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("the profit trend chart is visible without scrolling", async ({
    page,
  }) => {
    const chart = page.locator(".dash-chart");
    await expect(chart).toBeVisible();
    const box = (await chart.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(800);
  });
});
test.describe("first screen on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("the first sale on the details page is visible above the bottom navigation", async ({
    page,
  }) => {
    await page.goto("./#/details");
    const row = page.locator(".detail-row").first();
    await expect(row).toBeVisible();
    const nav = (await page
      .getByRole("navigation", { name: "手机导航" })
      .boundingBox())!;
    const box = (await row.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
  });
});

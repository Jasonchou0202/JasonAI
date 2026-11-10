import { test, expect, type Page } from "@playwright/test";
// 2026-11-10 生意手账优化验收（演示账本，本地运行，不连云端）
const instant = "2026-11-10T07:00:00.000Z"; // 北京时间 15:00
const demo = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!));
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript(() =>
    sessionStorage.setItem("zhangyuge-demo", "true"),
  );
});
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const [label, size] of [
  ["1440", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
] as const) {
  test(`看板：金额到元、无需求占比、商品贡献前 5 柱状图、无最近的销售、四色块树状图（${label}）`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("./#/dashboard");
    await expect(page.locator(".customer-ranks > li").first()).toBeVisible();
    const text = await page.locator(".dash-page").innerText();
    expect(text).not.toMatch(/¥\s?-?[\d,]+\.\d{2}/);
    await expect(page.getByText("客户需求占比")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "最近的销售" })).toHaveCount(
      0,
    );
    const bars = page.locator(".product-bar-chart > li");
    expect(await bars.count()).toBeGreaterThan(0);
    expect(await bars.count()).toBeLessThanOrEqual(5);
    const values = (await bars.locator(".money").allTextContents()).map((v) =>
      Number(v.replaceAll(",", "")),
    );
    expect(values).toEqual([...values].sort((a, b) => b - a));
    const heights = await bars
      .locator(".product-bar")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights).toEqual([...heights].sort((a, b) => b - a));
    const months = page.locator(".quad-treemap-month");
    await expect(months).toHaveCount(3);
    await expect(months.last()).toContainText("2026.11");
    expect(await noOverflow(page)).toBe(true);
  });

  test(`记一笔：下拉小箭头、成交日期默认今天、金额只收整数（${label}）`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("./#/dashboard");
    // 草稿里留着旧日期（没手动改过）：打开新建时回到今天
    await page.evaluate(() =>
      localStorage.setItem(
        "zhangyuge-draft-demo-new",
        JSON.stringify({
          productId: "",
          productName: "旧草稿",
          customer: "",
          date: "2026-11-01",
          revenue: "",
          cost: "",
          note: "",
          requestId: "draft-1",
        }),
      ),
    );
    await page.goto("./#/entry");
    await expect(page.getByLabel(/商品名称/)).toHaveValue("旧草稿");
    await expect(
      page.getByRole("button", {
        name: "成交日期：今天，点击修改",
        exact: true,
      }),
    ).toBeVisible();
    for (const name of ["展开商品候选", "展开客户候选"]) {
      const arrow = page.getByRole("button", { name, exact: true });
      await expect(arrow).toBeVisible();
      const box = (await arrow.boundingBox())!;
      expect(box.width).toBeGreaterThan(20);
    }
    await page
      .getByRole("button", { name: "展开客户候选", exact: true })
      .click();
    await expect(page.locator("#customer")).toBeFocused();
    await expect(page.getByLabel(/销售额/)).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    expect(
      await page
        .getByRole("group", { name: /常用商品/ })
        .getByRole("button")
        .count(),
    ).toBe(5);
    expect(await noOverflow(page)).toBe(true);
  });
}

test("记一笔顺手新增客户日程：先存销售再建日程，默认下个月同日 10:00，午休时段被拦", async ({
  page,
}) => {
  await page.goto("./#/entry");
  await page
    .getByRole("group", { name: /常用商品/ })
    .getByRole("button")
    .first()
    .click();
  const product = await page.getByLabel(/商品名称/).inputValue();
  const toggle = page.getByRole("checkbox", { name: /新增客户日程/ });
  await expect(toggle).toBeDisabled();
  await page.getByLabel("客户名称", { exact: false }).fill("示例客户 · 小林");
  await toggle.check();
  const at = page.getByLabel(/跟进时间/);
  await expect(at).toHaveValue("2026-12-10T10:00");
  await expect(page.getByLabel("要做什么")).toHaveAttribute(
    "placeholder",
    `续费提醒：${product}`,
  );
  const before = Object.keys((await demo(page)).sales).length;
  await at.fill("2026-12-10T13:00");
  await page.getByRole("button", { name: "保存这笔", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("12:30–14:00 不排日程");
  expect(Object.keys((await demo(page)).sales).length).toBe(before);
  await at.fill("2026-12-10T10:00");
  await page.getByRole("button", { name: "保存这笔", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  const data = await demo(page);
  expect(Object.keys(data.sales).length).toBe(before + 1);
  const tasks = Object.values(data.tasks) as any[];
  const task = tasks.find((t) => t.title === `续费提醒：${product}`);
  expect(task).toMatchObject({
    at: "2026-12-10T02:00:00.000Z",
    reminder: "both",
    completedAt: null,
  });
  const owner = data.customers[task.customerId];
  expect(owner.name).toBe("示例客户 · 小林");
  expect(owner.mergedInto).toBeFalsy();
});

for (const [label, size] of [
  ["1440", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
] as const) {
  test(`客户日程苹果风卡片：三张待办卡、今日日程横排、改期/完成、日程记录与客户搜索（${label}）`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("./#/dashboard");
    // 造 4 条今天的日程（本地演示账本）
    await expect(page.locator(".customer-ranks > li").first()).toBeVisible();
    await expect
      .poll(async () => Object.keys((await demo(page))?.customers ?? {}).length)
      .toBeGreaterThan(0);
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!);
      const c = (Object.values(data.customers) as any[]).find(
        (x) => !x.mergedInto,
      );
      for (const [i, at] of [
        "2026-11-10T01:00:00.000Z",
        "2026-11-10T08:00:00.000Z",
        "2026-11-10T11:30:00.000Z",
        "2026-11-10T12:00:00.000Z",
        "2026-11-09T12:00:00.000Z",
        "2026-11-11T01:30:00.000Z",
      ].entries())
        data.tasks["t" + i] = {
          id: "t" + i,
          customerId: c.id,
          at,
          title:
            "验收日程" +
            i +
            "，标题很长很长很长很长很长很长很长很长很长很长很长很长很长",
          feedback: "",
          nextAction: "",
          reminder: "off",
          completedAt: null,
          deletedAt: null,
          createdAt: at,
          updatedAt: at,
          revision: 1,
        };
      localStorage.setItem("zhangyuge-demo-v1", JSON.stringify(data));
      location.hash = "#/calendar";
    });
    await page.reload();
    const stats = page
      .getByRole("group", { name: "待办概览" })
      .getByRole("button");
    await expect(stats).toHaveCount(3);
    await expect(stats.nth(0)).toContainText("今日待办");
    await expect(stats.nth(0).locator(".apple-n")).toHaveText("3");
    await expect(stats.nth(1).locator(".apple-n")).toHaveText("1");
    await expect(stats.nth(2).locator(".apple-n")).toHaveText("2");
    const rail = page.locator(".customer-today .apple-rail");
    await expect(rail.locator("article")).toHaveCount(4);
    await expect(page.getByRole("button", { name: /全部 4 条/ })).toBeVisible();
    const first = (await rail.locator("article").nth(0).boundingBox())!;
    const second = (await rail.locator("article").nth(1).boundingBox())!;
    expect(second.x).toBeGreaterThan(first.x + first.width - 1); // 从左到右
    expect(Math.abs(second.y - first.y)).toBeLessThan(2);
    if (size.width === 390) {
      // 一屏一张半：第二张露出一部分
      expect(second.x).toBeLessThan(390);
      expect(second.x + second.width).toBeGreaterThan(390);
      await expect(page.locator(".apple-dots button").first()).toBeVisible();
    }
    const late = rail.locator("article").first();
    await expect(late.locator(".apple-state")).toHaveText("已逾期");
    await late.getByRole("button", { name: "完成", exact: true }).click();
    await expect(late.locator(".apple-state")).toContainText("已完成");
    await expect(
      late.getByRole("button", { name: "重新打开", exact: true }),
    ).toBeVisible();
    await late.getByRole("button", { name: "重新打开", exact: true }).click();
    await expect(
      late.getByRole("button", { name: "改期", exact: true }),
    ).toBeVisible();
    await late.getByRole("button", { name: "改期", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: "编辑跟进日程" }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .locator(".customer-actions .button.secondary")
      .click();
    await stats.nth(2).click();
    await expect(page.getByRole("dialog").locator("article")).toHaveCount(2);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭" })
      .first()
      .click();
    const history = page.locator(".customer-history");
    await expect(
      history.getByRole("heading", { name: "日程记录" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "客户搜索" })).toBeVisible();
    const hb = (await history.boundingBox())!,
      sb = (await page.locator(".apple-search").boundingBox())!;
    if (size.width === 390)
      expect(sb.y).toBeGreaterThan(hb.y + hb.height - 1); // 上下排
    else expect(sb.x).toBeGreaterThan(hb.x + hb.width - 1); // 左右排
    expect(await noOverflow(page)).toBe(true);
  });
}

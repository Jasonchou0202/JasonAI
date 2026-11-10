import { test, expect, type Page } from "@playwright/test";
// 11-10 补充两处验收（演示账本，本地运行，不连云端）：
// 1) 记一笔「新增客户日程」也能按客户色块多选有效动作；2) 客户详情页日程区改苹果风卡片
const instant = "2026-11-10T07:00:00.000Z"; // 北京时间 15:00
const ROOT_LDJ = "c-ldj-root",
  LLT = "c-llt";
const demo = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!));
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript(() =>
    sessionStorage.setItem("zhangyuge-demo", "true"),
  );
  await page.goto("./#/dashboard");
  await expect(page.locator(".customer-ranks > li").first()).toBeVisible();
  // 仿真实账本：李德嘉（带 IP 的主档 + 一个已合并的别名）只买老品；李蓝天老品、新品都买过
  await page.evaluate(
    ({ ROOT_LDJ, LLT }) => {
      const data = JSON.parse(localStorage.getItem("zhangyuge-demo-v1")!);
      const t = "2026-09-01T00:00:00.000Z";
      const customer = (
        id: string,
        name: string,
        mergedInto: string | null,
      ) => ({
        id,
        name,
        mergedInto,
        revision: 1,
        createdAt: t,
        updatedAt: t,
      });
      data.customers[ROOT_LDJ] = customer(
        ROOT_LDJ,
        "✅李德嘉63.124.162.53",
        null,
      );
      data.customers["c-ldj-alias"] = customer(
        "c-ldj-alias",
        "✅李德嘉",
        ROOT_LDJ,
      );
      data.customers[LLT] = customer(LLT, "李蓝天", null);
      const sale = (
        id: string,
        customer: string,
        productName: string,
        date: string,
      ) => ({
        id,
        productId: "",
        productName,
        customer,
        date,
        revenue: 18000,
        cost: 10000,
        note: "",
        revision: 1,
        createdAt: t,
        updatedAt: t,
        deletedAt: null,
      });
      data.sales["bu-1"] = sale(
        "bu-1",
        "✅李德嘉63.124.162.53",
        "补充验收老品",
        "2026-09-01",
      );
      data.sales["bu-2"] = sale("bu-2", "李蓝天", "补充验收老品", "2026-09-02");
      data.sales["bu-3"] = sale("bu-3", "李蓝天", "补充验收新品", "2026-11-01");
      const task = (
        id: string,
        at: string,
        title: string,
        completedAt: string | null = null,
      ) => ({
        id,
        customerId: ROOT_LDJ,
        at,
        title,
        feedback: "",
        nextAction: "",
        reminder: "both",
        revision: 1,
        createdAt: t,
        updatedAt: t,
        completedAt,
        deletedAt: null,
      });
      data.tasks["bu-t1"] = task(
        "bu-t1",
        "2026-11-10T08:00:00.000Z",
        "李德嘉今天的回访",
      );
      data.tasks["bu-t2"] = task(
        "bu-t2",
        "2026-12-12T01:00:00.000Z",
        "第二次订阅续费提醒",
      );
      data.tasks["bu-t3"] = task(
        "bu-t3",
        "2026-10-30T01:00:00.000Z",
        "了解新需求",
        "2026-10-30T02:00:00.000Z",
      );
      localStorage.setItem("zhangyuge-demo-v1", JSON.stringify(data));
    },
    { ROOT_LDJ, LLT },
  );
  await page.reload();
});
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function openSchedule(page: Page, who: string) {
  // 每次从空白新建开始（清掉上一轮留下的记一笔草稿）
  await page.goto("./#/dashboard");
  await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith("zhangyuge-draft-"))
      .forEach((k) => localStorage.removeItem(k)),
  );
  await page.goto("./#/entry");
  await page
    .getByRole("group", { name: /常用商品/ })
    .getByRole("button")
    .first()
    .click();
  const product = await page.getByLabel(/商品名称/).inputValue();
  const toggle = page.getByRole("checkbox", { name: /新增客户日程/ });
  await expect(toggle).toBeDisabled();
  // 没填客户：勾不了，也不出现有效动作
  await expect(page.locator(".entry-schedule .action-picker")).toHaveCount(0);
  await page.getByLabel("客户名称", { exact: false }).fill(who);
  await toggle.check();
  return {
    product,
    picker: page
      .locator(".entry-schedule")
      .getByRole("group", { name: /有效动作/ }),
  };
}

for (const [label, size] of [
  ["1440", { width: 1440, height: 900 }],
  ["390", { width: 390, height: 844 }],
] as const) {
  test(`记一笔顺手建日程的有效动作：李德嘉只出老客老品，李蓝天出老客老品+老客新品（${label}）`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    let { picker } = await openSchedule(page, "李德嘉");
    await expect(picker.locator(".action-picker-group")).toHaveCount(1);
    await expect(picker.locator('[data-quadrant="oldOld"]')).toBeVisible();
    await expect(
      picker.getByRole("button", { name: "沟通了解新需求" }),
    ).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    ({ picker } = await openSchedule(page, "李蓝天"));
    await expect(picker.locator(".action-picker-group")).toHaveCount(2);
    await expect(picker.locator('[data-quadrant="oldOld"]')).toBeVisible();
    await expect(picker.locator('[data-quadrant="oldNew"]')).toBeVisible();
    await expect(picker.getByRole("button", { name: "分销机制" })).toHaveCount(
      0,
    );
    // 换客户：已勾的动作清空，色块跟着换
    await picker.getByRole("button", { name: "沟通了解新需求" }).click();
    await page.getByLabel("客户名称", { exact: false }).fill("李德嘉");
    await expect(picker.locator(".action-picker-group")).toHaveCount(1);
    await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
  });
}

test("选了动作：标题按跟进日程写法揽进动作，其余进下一步；仍先存销售再建日程", async ({
  page,
}) => {
  const { picker } = await openSchedule(page, "李蓝天");
  const title = page.getByLabel("要做什么");
  await picker
    .getByRole("button", { name: "核心客户维护好，持续赋能，增加粘度" })
    .click();
  await picker.getByRole("button", { name: "沟通了解新需求" }).click();
  await expect(
    picker.getByRole("button", { name: /沟通了解新需求/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(title).toHaveAttribute(
    "placeholder",
    "【老客老品】核心客户维护好，持续赋能，增加粘度",
  );
  await expect(page.getByTestId("schedule-next")).toHaveText(
    "下一步：【老客新品】沟通了解新需求",
  );
  // 默认下月同日 10:00；午休被拦，且销售不先存
  const at = page.getByLabel(/跟进时间/);
  await expect(at).toHaveValue("2026-12-10T10:00");
  const before = Object.keys((await demo(page)).sales).length;
  await at.fill("2026-12-10T12:30");
  await page.getByRole("button", { name: "保存这笔", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("12:30–14:00 不排日程");
  expect(Object.keys((await demo(page)).sales).length).toBe(before);
  await at.fill("2026-12-10T10:00");
  await page.getByRole("button", { name: "保存这笔", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  const data = await demo(page);
  expect(Object.keys(data.sales).length).toBe(before + 1);
  const task = (Object.values(data.tasks) as any[]).find(
    (t) => t.title === "【老客老品】核心客户维护好，持续赋能，增加粘度",
  );
  expect(task).toMatchObject({
    customerId: LLT,
    at: "2026-12-10T02:00:00.000Z",
    nextAction: "【老客新品】沟通了解新需求",
  });
});

test("没选动作：标题仍是「续费提醒：商品名」；手填标题时动作全进下一步；按别名记到合并后的主客户", async ({
  page,
}) => {
  let { product, picker } = await openSchedule(page, "李德嘉");
  await expect(page.getByLabel("要做什么")).toHaveAttribute(
    "placeholder",
    `续费提醒：${product}`,
  );
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await expect
    .poll(async () =>
      (Object.values((await demo(page)).tasks) as any[]).find(
        (t) => t.title === `续费提醒：${product}`,
      ),
    )
    .toMatchObject({ customerId: ROOT_LDJ, nextAction: "" });
  ({ product, picker } = await openSchedule(page, "李德嘉"));
  await page.getByLabel("要做什么").fill("年费到期沟通");
  await picker.getByRole("button", { name: "断购客户转化为复购" }).click();
  await expect(page.getByTestId("schedule-next")).toHaveText(
    "下一步：【老客老品】断购客户转化为复购",
  );
  await page.getByRole("button", { name: "保存这笔", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  const task = (Object.values((await demo(page)).tasks) as any[]).find(
    (t) => t.title === "年费到期沟通",
  );
  expect(task).toMatchObject({
    customerId: ROOT_LDJ,
    nextAction: "【老客老品】断购客户转化为复购",
  });
});

for (const [label, size, radius] of [
  ["1440", { width: 1440, height: 900 }, "28px"],
  ["390", { width: 390, height: 844 }, "24px"],
] as const) {
  test(`客户详情页日程区苹果风：浅灰底块、白卡、状态点、色块胶囊、完成/改期接现有功能（${label}）`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto(`./#/customer?id=${ROOT_LDJ}`);
    const section = page.locator(".customer-calendar-page.apple-section");
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("heading", { name: "客户日程", exact: true }),
    ).toBeVisible();
    expect(
      await section.evaluate((e) => getComputedStyle(e).backgroundColor),
    ).toBe("rgb(245, 245, 247)");
    // 只改日程这一区：整页背景不变成浅灰
    expect(
      await page
        .locator(".main-shell")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
    ).not.toBe("rgb(245, 245, 247)");
    await expect(section.locator(".apple-stats .apple-card")).toHaveCount(3);
    const cards = section.locator(".customer-today .apple-task");
    await expect(cards).toHaveCount(2); // 今天 1 条 + 还没完成的 1 条（已完成的旧日程不进卡片）
    const first = cards.filter({ hasText: "李德嘉今天的回访" });
    expect(await first.evaluate((e) => getComputedStyle(e).borderRadius)).toBe(
      radius,
    );
    expect(
      await first.evaluate((e) => getComputedStyle(e).boxShadow),
    ).toContain("rgba(0, 0, 0, 0.04)");
    await expect(first.locator(".apple-dot")).toBeVisible();
    await expect(first.locator(".apple-chips")).toContainText("老客老品");
    await expect(
      cards.filter({ hasText: "第二次订阅续费提醒" }).locator(".apple-time"),
    ).toHaveText("12月12日 09:00");
    // 改期 → 打开现有编辑弹窗
    await first.getByRole("button", { name: "改期", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "编辑跟进日程" }),
    ).toBeVisible();
    await dialog.getByLabel("关闭").click();
    await expect(dialog).toHaveCount(0);
    // 完成 → 状态变已完成，底部换成「重新打开 / 安排下一次」
    await first.getByRole("button", { name: "完成", exact: true }).click();
    await expect(first.locator(".apple-state")).toContainText("已完成");
    await expect(
      first.getByRole("button", { name: "重新打开", exact: true }),
    ).toBeVisible();
    await first.getByRole("button", { name: "重新打开", exact: true }).click();
    await expect(
      first.getByRole("button", { name: "完成", exact: true }),
    ).toBeVisible();
    const done = (await demo(page)).tasks["bu-t1"];
    expect(done.completedAt).toBeNull();
    // 非今天的待办点完成：今天刚完成的仍留在卡片里，可就地重新打开
    const later = cards.filter({ hasText: "第二次订阅续费提醒" });
    await later.getByRole("button", { name: "完成", exact: true }).click();
    await expect(later.locator(".apple-state")).toContainText("已完成");
    await expect(
      later.getByRole("button", { name: "安排下一次" }),
    ).toBeVisible();
    await later.getByRole("button", { name: "重新打开", exact: true }).click();
    await expect(
      later.getByRole("button", { name: "改期", exact: true }),
    ).toBeVisible();
    await expect(
      section.getByRole("heading", { name: /今日日程与待跟进/ }),
    ).toBeVisible();
    // 历史日程：苹果风记录行，卡内可搜索
    const history = section.locator(".customer-history");
    await expect(
      history.getByRole("heading", { name: "历史日程" }),
    ).toBeVisible();
    await expect(history.locator(".apple-log")).toHaveCount(3);
    await history.getByRole("searchbox").fill("新需求");
    await expect(history.locator(".apple-log")).toHaveCount(1);
    // 月历照旧
    await expect(section.locator(".customer-calendar-grid")).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
  });
}

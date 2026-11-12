import { test, expect, type Page } from "@playwright/test";
// 团队账号与操作日志验收（演示账本，本地运行，全部虚构数据）
const instant = "2026-11-12T04:00:00.000Z"; // 北京时间 12:00
function row(id: string, customer: string, createdBy?: string) {
  return {
    id, productId: "", productName: "演示商品", customer, date: "2026-11-12",
    revenue: 20000, cost: 5000, note: "虚构", createdAt: instant, updatedAt: instant,
    deletedAt: null, revision: 1, ...(createdBy ? { createdBy } : {}),
  };
}
async function demo(page: Page, role: "admin" | "member" | null) {
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript(
    ([role, data]) => {
      sessionStorage.setItem("zhangyuge-demo", "true");
      if (role) sessionStorage.setItem("zhangyuge-demo-role", role);
      if (!localStorage.getItem("zhangyuge-demo-v1"))
        localStorage.setItem("zhangyuge-demo-v1", data);
    },
    [
      role,
      JSON.stringify({
        sales: {
          mine: row("mine", "示例客户·自己录", "demo-member"),
          legacy: row("legacy", "示例客户·旧数据"),
        },
      }),
    ] as const,
  );
}
const nav = (page: Page) => page.getByRole("navigation", { name: "主要导航" });

test("开关关（默认演示）：导航与原来一致，没有成员和日志入口", async ({ page }) => {
  await demo(page, null);
  await page.goto("./");
  await expect(nav(page).getByRole("button", { name: "账本设置" })).toBeVisible();
  await expect(nav(page).getByRole("button", { name: "内容生产板块" })).toBeVisible();
  await expect(nav(page).getByRole("button", { name: "成员管理" })).toHaveCount(0);
  await expect(nav(page).getByRole("button", { name: "操作日志" })).toHaveCount(0);
  await expect(nav(page).getByRole("button", { name: "我的操作记录" })).toHaveCount(0);
  if (process.env.TEAM_SHOTS) {
    await page.goto("./#/details");
    await expect(page.getByRole("button", { name: "回收站" })).toBeVisible();
    await page.screenshot({ path: `${process.env.TEAM_SHOTS}/before-off-details-1280.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.TEAM_SHOTS}/before-off-details-390.png` });
  }
});

test("管理员：生成邀请链接，操作日志能看到自己的写操作", async ({ page }) => {
  await demo(page, "admin");
  await page.goto("./#/members");
  await expect(page.getByRole("heading", { name: "成员管理" })).toBeVisible();
  await page.getByLabel("成员备注名").fill("小测");
  await page.getByRole("button", { name: "生成邀请链接" }).click();
  await expect(page.getByTestId("invite-link")).toContainText("#/join?code=");
  const code = (await page.getByTestId("invite-link").innerText()).split("code=")[1];
  expect(code).toMatch(/^[0-9a-f]{32}$/);
  await expect(page.getByText("演示成员")).toBeVisible();
  await page.goto("./#/audit");
  await expect(page.getByRole("heading", { name: "操作日志" })).toBeVisible();
  const table = page.getByRole("table", { name: "操作日志" });
  await expect(table).toContainText("members.invite.create");
  await expect(table).not.toContainText(code);
  await expect(page.getByLabel("操作人")).toBeVisible();
  if (process.env.TEAM_SHOTS) {
    await page.screenshot({ path: `${process.env.TEAM_SHOTS}/admin-audit-1280.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.TEAM_SHOTS}/admin-audit-390.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("./#/members");
    await expect(page.getByRole("heading", { name: "成员管理" })).toBeVisible();
    await page.screenshot({ path: `${process.env.TEAM_SHOTS}/admin-members-1280.png` });
  }
});

test("成员：看不到系统入口，直达系统页被送回；只能删自己录的；我的操作记录只有自己", async ({ page }) => {
  await demo(page, "member");
  await page.goto("./");
  await expect(nav(page).getByRole("button", { name: "生意看板" })).toBeVisible();
  for (const name of ["账本设置", "成员管理", "操作日志", "内容生产板块"])
    await expect(nav(page).getByRole("button", { name })).toHaveCount(0);
  await expect(nav(page).getByRole("button", { name: "我的操作记录" })).toBeVisible();
  await page.goto("./#/settings");
  await expect(page).toHaveURL(/#\/dashboard$/);
  await page.goto("./#/audit");
  await expect(page).toHaveURL(/#\/my-log$/);
  await page.goto("./#/details");
  await expect(page.getByRole("button", { name: "回收站" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出明细" })).toHaveCount(0);
  await page.getByRole("button", { name: /更多操作：演示商品 示例客户·旧数据/ }).click();
  await expect(page.getByRole("menuitem", { name: /删除/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /更多操作：演示商品 示例客户·自己录/ }).click();
  await page.getByRole("menuitem", { name: /删除演示商品/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /移入回收站|删除/ }).click();
  await expect(page.getByText("记录已移入回收站")).toBeVisible();
  await page.goto("./#/my-log");
  const table = page.getByRole("table", { name: "操作日志" });
  await expect(table).toContainText("sales.delete");
  await expect(page.getByLabel("操作人")).toHaveCount(0);
});

for (const [label, size] of [["1280", { width: 1280, height: 800 }], ["390", { width: 390, height: 844 }]] as const)
  test(`截图 ${label}：成员视角与管理员日志`, async ({ page }) => {
    await page.setViewportSize(size);
    await demo(page, "member");
    await page.goto("./#/details");
    await expect(page.getByRole("heading", { name: "销售明细" })).toBeVisible();
    if (process.env.TEAM_SHOTS)
      await page.screenshot({ path: `${process.env.TEAM_SHOTS}/member-details-${label}.png`, fullPage: false });
    await page.getByRole("button", { name: /更多操作：演示商品 示例客户·自己录/ }).click();
    await page.getByRole("menuitem", { name: /删除演示商品/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "移入回收站" }).click();
    await expect(page.getByText("记录已移入回收站")).toBeVisible();
    await page.goto("./#/my-log");
    await expect(page.getByRole("heading", { name: "我的操作记录" })).toBeVisible();
    if (process.env.TEAM_SHOTS)
      await page.screenshot({ path: `${process.env.TEAM_SHOTS}/member-mylog-${label}.png`, fullPage: false });
  });

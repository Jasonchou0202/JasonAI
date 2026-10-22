import { test, expect, type Page } from "@playwright/test";

const shots = process.env.PROFILE_SHOTS;
async function shot(page: Page, name: string, el?: string) {
  if (!shots) return;
  await page.addStyleTag({ content: "*{transition:none!important;animation:none!important}" });
  if (el) await page.locator(el).first().screenshot({ path: `${shots}/${name}.png` });
  else await page.screenshot({ path: `${shots}/${name}.png` });
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-22T04:00:00.000Z"));
  await page.addInitScript(() => sessionStorage.setItem("zhangyuge-demo", "true"));
});
async function open(page: Page, name: string) {
  await page.goto("./#/dashboard");
  await page.locator(".customer-ranking").getByText(name, { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

for (const [label, size] of [["桌面", { width: 1366, height: 900 }], ["手机390", { width: 390, height: 844 }]] as const) {
  test(`客户标签、信息收集与需求占比（${label}）`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page, "示例客户 · 小林");
    const chips = page.locator(".profile-chips");
    await expect(chips.locator(".tier-badge")).toHaveText(/^P[0-4]$/);
    await expect(chips.locator(".quad-blocks i")).toHaveCount(4);
    await expect(chips).not.toContainText("客户产品矩阵");
    await expect(page.getByRole("heading", { name: "客户信息收集和需求收集" })).toBeVisible();
    await expect(chips).not.toContainText("客户等级");
    await expect(chips.getByText("复购客户")).toHaveAttribute("title", /每个月都有付款/);
    await page.getByRole("button", { name: "编辑客户信息和需求" }).click();
    const form = page.locator(".profile-form");
    await form.getByRole("button", { name: "律师", exact: true }).click();
    await form.getByLabel("Agent 学习").check();
    await form.getByLabel("Grok Bot").check();
    await form.getByLabel("新增需求选项").fill("资料整理");
    await form.getByRole("button", { name: "添加" }).click();
    await expect(form.getByLabel("资料整理")).toBeChecked();
    await form.getByLabel("需求记录").fill("想系统学 Agent，预算一千左右");
    await form.getByLabel("偏好付款方式").selectOption("闲鱼支付");
    await shot(page, `${label}-信息收集和需求收集编辑`, ".profile-editor");
    await form.getByRole("button", { name: "保存客户信息和需求" }).click();
    await expect(chips.getByText("律师")).toBeVisible();
    await expect(chips.getByText("闲鱼支付")).toBeVisible();
    await expect(page.locator(".profile-view")).toContainText("Agent 学习、Grok Bot、资料整理");
    await page.locator(".customer-details .page-heading").scrollIntoViewIfNeeded();
    await shot(page, `${label}-客户名下标签行`, ".customer-details .page-heading");

    await open(page, "示例客户 · 阿远");
    await page.getByRole("button", { name: "编辑客户信息和需求" }).click();
    await page.locator(".profile-form").getByLabel("Agent 学习").check();
    await page.locator(".profile-form").getByLabel("AI 视频生成").check();
    await page.locator(".profile-form").getByRole("button", { name: "保存客户信息和需求" }).click();
    await expect(page.locator(".profile-chips")).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑客户信息和需求" })).toBeVisible();

    await page.goto("./#/dashboard");
    const chart = page.locator(".need-chart");
    await expect(chart).toContainText("已记录需求的客户数（2 位）");
    await expect(chart.locator("li").first()).toContainText("Agent 学习");
    await expect(chart.locator("li").first()).toContainText("2 位 · 100%");
    await chart.scrollIntoViewIfNeeded();
    await shot(page, `${label}-客户需求占比`, ".need-chart");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

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
  test(`客户标签、信息收集；看板不显示需求占比（${label}）`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page, "示例客户 · 小林");
    const chips = page.locator(".profile-chips");
    await expect(chips.locator(".tier-badge")).toHaveText(/^P[0-4]$/);
    await expect(chips.locator(".quad-blocks i")).toHaveCount(4);
    await expect(chips).not.toContainText("客户产品矩阵");
    await expect(page.getByRole("heading", { name: "客户信息和需求收集" })).toBeVisible();
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

    // 2026-11：看板上不再显示「客户需求占比」，需求数据仍在客户详情里可看可填
    await expect(page.locator(".profile-view")).toContainText("Agent 学习");
    await page.goto("./#/dashboard");
    await expect(page.locator(".customer-ranking")).toBeVisible();
    await expect(page.locator(".need-chart")).toHaveCount(0);
    await expect(page.getByText("客户需求占比")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("Claude 账号：勾选后展开、终端无手机号、保存后按条显示摘要", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, "示例客户 · 小林");
  await page.getByRole("button", { name: "编辑客户信息和需求" }).click();
  const form = page.locator(".profile-form");
  await form.getByLabel("Claude 质保需求").check();
  await expect(form.getByText("Claude 账号", { exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: "删除" })).toHaveCount(0);
  await form.getByRole("button", { name: "Claude Max" }).click();
  await form.getByRole("button", { name: "网页端" }).click();
  await form.getByRole("button", { name: "Windows 电脑" }).click();
  await form.getByLabel("第 1 个 Claude 注册邮箱").fill("example01@mail.com");
  await form.getByLabel("第 1 个 HubStudio 注册手机号").fill("138****0001");
  await form.getByRole("button", { name: "添加账号" }).click();
  await expect(form.getByRole("button", { name: "删除" })).toHaveCount(2);
  await form.locator(".acct").nth(1).getByRole("button", { name: "Claude Ultra" }).click();
  await form.locator(".acct").nth(1).getByRole("button", { name: "终端" }).click();
  await form.locator(".acct").nth(1).getByRole("button", { name: "苹果电脑" }).click();
  await form.getByLabel("第 2 个 Claude 注册邮箱").fill("example02@mail.com");
  await expect(form.getByLabel("第 2 个 HubStudio 注册手机号")).toHaveCount(0);
  await expect(form.locator("input[type=password]")).toHaveCount(0);
  await form.getByRole("button", { name: "保存客户信息和需求" }).click();
  const view = page.locator(".profile-view");
  await expect(view).toContainText("Claude 质保需求");
  await expect(view).toContainText("① Max · 网页端 · Windows 电脑 · example01@mail.com · HubStudio 138****0001");
  await expect(view).toContainText("② Ultra · 终端 · 苹果电脑 · example02@mail.com");
});

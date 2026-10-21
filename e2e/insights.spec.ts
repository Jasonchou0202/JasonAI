import { test, expect, type Page } from "@playwright/test";

// 北京时间 2026-10-22 12:00：演示账本会在当天带上分界日后新增的示例客户和商品
const instant = "2026-10-22T04:00:00.000Z";
const shots = process.env.TIER_SHOTS;
async function shot(page: Page, name: string) {
  if (shots) await page.addStyleTag({ content: "*{transition:none!important;animation:none!important}" });
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript(() => sessionStorage.setItem("zhangyuge-demo", "true"));
});

for (const [label, size] of [["桌面", { width: 1366, height: 900 }], ["手机390", { width: 390, height: 844 }]] as const) {
  test(`客户等级、客户产品矩阵、每月图表与有效动作（${label}）`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("./#/dashboard");
    const ranking = page.locator(".customer-ranking");
    await expect(ranking.getByRole("group", { name: "按客户等级筛选" })).toBeVisible();
    await expect(ranking.locator(".customer-ranks .tier-badge").first()).toBeVisible();
    await ranking.getByText("客户等级说明").click();
    await expect(ranking.getByText("纯利 ≥ ¥10,000")).toBeVisible();
    await expect(ranking.getByRole("button", { name: /^P0 · \d+/ })).toBeVisible();
    await ranking.locator(".tier-chips").scrollIntoViewIfNeeded();
    await shot(page, `${label}-核心客户等级筛选`);
    await ranking.locator(".tier-legend").scrollIntoViewIfNeeded();
    await shot(page, `${label}-客户等级说明`);
    await ranking.getByRole("button", { name: /^P4 · \d+/ }).click();
    await expect(ranking.getByText("示例新客 · 小周")).toBeVisible();
    await expect(ranking.getByText("示例客户 · 木木")).toHaveCount(0);
    await ranking.getByRole("button", { name: /^全部 · \d+/ }).click();

    const matrix = page.locator(".quad-panel");
    await expect(matrix.getByRole("heading", { name: /客户 × 产品矩阵/ })).toBeVisible();
    for (const q of ["newOld", "newNew", "oldOld", "oldNew"])
      await expect(matrix.locator(`[data-quadrant="${q}"]`)).toHaveClass(/on/);
    await matrix.scrollIntoViewIfNeeded();
    await shot(page, `${label}-客户产品矩阵-本月`);
    for (const tab of ["本季度", "本年"]) {
      await matrix.getByRole("tab", { name: tab }).click();
      await expect(matrix.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await expect(matrix.locator('[data-quadrant="oldOld"]')).toContainText("笔");
      await shot(page, `${label}-客户产品矩阵-${tab}`);
    }

    const trend = page.locator(".monthly-chart").first();
    await expect(trend.getByText("每月新进客户数（按首次购买月份")).toBeVisible();
    await trend.scrollIntoViewIfNeeded();
    await shot(page, `${label}-每月新增客户走势`);
    const qm = page.locator(".monthly-chart").nth(1);
    await expect(qm.locator(".quad-months li").first()).toContainText("2026.10");
    await qm.scrollIntoViewIfNeeded();
    await shot(page, `${label}-每月四色块客户数与占比`);

    await ranking.getByText("示例客户 · 小林").click();
    await expect(page.locator(".customer-insight-line .tier-badge")).toBeVisible();
    await expect(page.locator(".customer-insight-line .quad-blocks i")).toHaveCount(4);
    await shot(page, `${label}-客户详情等级与色块`);

    await page.goto("./#/calendar");
    const lib = page.locator(".action-library");
    await expect(lib.getByText("断购客户转化为复购")).toBeVisible();
    await lib.getByRole("button", { name: "添加动作" }).first().click();
    await lib.getByLabel("新客户 × 老产品动作内容").fill("社群裂变活动");
    await lib.getByRole("button", { name: "保存" }).click();
    await expect(lib.getByText("社群裂变活动")).toBeVisible();
    await lib.scrollIntoViewIfNeeded();
    await shot(page, `${label}-有效动作库`);
    await page.reload();
    await expect(page.locator(".action-library").getByText("社群裂变活动")).toBeVisible();
    await page.locator(".action-library").getByRole("button", { name: "把「沟通了解新需求」加入日程" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("要做什么")).toHaveValue("【老客新品】沟通了解新需求");
    await dialog.getByText("引用有效动作").click();
    await dialog.getByRole("button", { name: "分销机制" }).click();
    await expect(dialog.getByLabel("下一步")).toHaveValue(/【新客老品】分销机制/);
    await shot(page, `${label}-日程引用有效动作`);
  });
}

test("灰色象限显示待开拓和动作提示", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-14T04:00:00.000Z"));
  await page.goto("./#/dashboard");
  const cell = page.locator('.quad-panel [data-quadrant="newNew"]');
  await expect(cell).toHaveClass(/empty/);
  await expect(cell).toContainText("待开拓");
  await expect(cell.getByRole("link", { name: /有效动作/ })).toHaveAttribute("href", "#/calendar?actions=newNew");
});

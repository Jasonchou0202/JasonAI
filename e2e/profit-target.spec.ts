import { test, expect } from "@playwright/test";

const shots = process.env.PROFIT_SHOTS;
for (const plan of ["方案A-线性"] as const)
  for (const [label, size] of [["桌面", { width: 1366, height: 900 }], ["手机390", { width: 390, height: 844 }]] as const)
    test(`每月利润目标走势 ${plan}（${label}）`, async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-22T04:00:00.000Z"));
      await page.addInitScript(() => sessionStorage.setItem("zhangyuge-demo", "true"));
      await page.setViewportSize(size);
      await page.goto("./#/dashboard");
      await page.getByRole("button", { name: "每月" }).click();
      const chart = page.locator(".profit-target");
      await expect(chart.getByText("目标走势（虚线）")).toBeVisible();
      await expect(chart.getByText("实际利润走势（线）")).toBeVisible();
      await expect(chart.locator(".pt-note")).toContainText("目标从 2026 年 09 月实际利润起，每月增加约");
      await expect(chart.locator(".pt-xtick")).toHaveText(["26年8月", "9月", "10月", "11月", "12月", "27年1月"]);
      await expect(chart.locator(".pt-ghost")).toHaveCount(3);
      await expect(chart.locator(".pt-progress")).toContainText("距 2027.12 月利 10万 目标：本月截至今日完成");
      await expect(chart.locator(".pt-readout")).toContainText("差距");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const snap = async (name: string) => {
        if (!shots) return;
        await page.addStyleTag({ content: "*{transition:none!important;animation:none!important}" });
        await page.waitForTimeout(300);
        await page.locator(".trend-panel").screenshot({ path: `${shots}/${plan}-${label}-${name}.png` });
      };
      await snap("默认");
      const slider = chart.getByRole("slider", { name: "选择显示的月份范围" });
      await slider.fill(await slider.getAttribute("max") as string);
      await expect(chart.locator(".pt-end text")).toHaveText("2027.12 目标 ¥10万");
      await expect(chart.locator(".pt-xtick").last()).toHaveText("12月");
      await snap("滑到2027年12月");
      await chart.getByRole("button", { name: "回到本月" }).click();
      await expect(chart.locator(".pt-xtick").first()).toHaveText("26年8月");
    });

test("公开看板没有金额，也没有利润目标图", async ({ page }) => {
  const res = await page.goto("./board-e160b241a233/");
  expect(res?.status()).toBe(200);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/¥|￥|利润|目标走势/);
  await expect(page.locator(".profit-target")).toHaveCount(0);
});

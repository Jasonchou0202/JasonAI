import { test, expect } from "@playwright/test";

const shots = process.env.PROFIT_SHOTS;
for (const [plan, curve] of [["方案A-线性", "linear"], ["方案B-复合增长", "compound"]] as const)
  for (const [label, size] of [["桌面", { width: 1366, height: 900 }], ["手机390", { width: 390, height: 844 }]] as const)
    test(`每月利润目标走势 ${plan}（${label}）`, async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-22T04:00:00.000Z"));
      await page.addInitScript((c) => {
        sessionStorage.setItem("zhangyuge-demo", "true");
        if (c === "compound") localStorage.setItem("zhangyuge-profit-target-curve", "compound");
      }, curve);
      await page.setViewportSize(size);
      await page.goto("./#/dashboard");
      await page.getByRole("button", { name: "每月" }).click();
      const chart = page.locator(".profit-target");
      await expect(chart.getByText("目标走势（虚线）")).toBeVisible();
      await expect(chart.getByText("实际利润走势（线）")).toBeVisible();
      await expect(chart.locator(".pt-end text")).toHaveText("2027.12 ¥10万");
      await expect(chart.locator(".pt-note")).toContainText(curve === "compound" ? "每月增长" : "每月增加约");
      await chart.locator(".pt-col").nth(10).click();
      await expect(chart.locator(".pt-readout")).toContainText("差距");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (shots) {
        await page.addStyleTag({ content: "*{transition:none!important;animation:none!important}" });
        await page.locator(".trend-panel").screenshot({ path: `${shots}/${plan}-${label}.png` });
        console.log("NOTE", await chart.locator(".pt-note").innerText());
      }
    });

test("公开看板没有金额，也没有利润目标图", async ({ page }) => {
  const res = await page.goto("./board-e160b241a233/");
  expect(res?.status()).toBe(200);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/¥|￥|利润|目标走势/);
  await expect(page.locator(".profit-target")).toHaveCount(0);
});

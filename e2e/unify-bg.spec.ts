import { test, expect, type Page } from "@playwright/test";
// 11-11 统一底色验收（只看样式，演示账本，本地运行）：
// 全站页面底色 = 品牌手册「主底·浅奶油」#FBF3E4，卡片白色，不再有粉色渐变、#F5F5F7 浅灰底和第二种米色 #FDF8EF
const instant = "2026-11-11T02:00:00.000Z"; // 北京时间 10:00
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript(() =>
    sessionStorage.setItem("zhangyuge-demo", "true"),
  );
});
const CREAM = "rgb(251, 243, 228)";
const BANNED = [
  "rgb(245, 245, 247)", // 苹果浅灰
  "rgb(246, 227, 211)", // 旧粉 #F6E3D3
  "rgb(253, 248, 239)", // 第二种米色 #FDF8EF
];
async function audit(page: Page) {
  return page.evaluate((banned) => {
    const bad: string[] = [];
    const gradients: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 20000) continue; // 只看大块底色；小胶囊/色块另说
      const st = getComputedStyle(el);
      if (banned.includes(st.backgroundColor))
        bad.push(`${el.className} ${st.backgroundColor}`);
      if (st.backgroundImage.includes("radial-gradient"))
        gradients.push(String(el.className));
    }
    return {
      root: getComputedStyle(document.documentElement).backgroundColor,
      bad,
      gradients,
    };
  }, BANNED);
}
for (const [label, size] of [
  ["1280", { width: 1280, height: 800 }],
  ["390", { width: 390, height: 844 }],
] as const) {
  for (const [name, hash, ready] of [
    ["看板", "./#/dashboard", ".customer-ranks > li"],
    ["记一笔", "./#/entry", "#product-name"],
    ["日程页", "./#/calendar", ".customer-calendar-grid"],
    ["账本设置", "./#/settings", "main h1"],
    ["销售明细", "./#/details", "main h1"],
  ] as const) {
    test(`${name}：奶油底 + 白卡，没有粉/灰/第二种米色大块底（${label}）`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto(hash);
      await expect(page.locator(ready).first()).toBeVisible();
      const r = await audit(page);
      expect(r.root).toBe(CREAM);
      expect(r.bad).toEqual([]);
      expect(r.gradients).toEqual([]);
      const panels = page.locator("main .panel");
      const n = await panels.count();
      for (let i = 0; i < n; i++) {
        const p = panels.nth(i);
        if (!(await p.isVisible())) continue;
        const bg = await p.evaluate((e) => getComputedStyle(e).backgroundColor);
        // 区块卡片统一白色（筛选条等嵌在卡里的小块除外，它们也是白的或透明）
        expect(["rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"]).toContain(bg);
      }
    });
  }
}
test("状态栏 theme-color 与 PWA 清单跟页面同一奶油底", async ({ page }) => {
  await page.goto("./#/dashboard");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#fbf3e4",
  );
  const manifest = await (
    await page.request.get("./manifest.webmanifest")
  ).json();
  expect(manifest.theme_color).toBe("#fbf3e4");
  expect(manifest.background_color).toBe("#fbf3e4");
});
test("弹窗是白卡；手机底部导航和电脑侧栏保持白色（页面仍是奶油底）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./#/calendar");
  await page.getByRole("button", { name: "新增日程" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toBe("rgb(255, 255, 255)");
  await dialog.getByLabel("关闭").click();
  const nav = page.locator("nav.mobile-nav");
  expect(
    await nav.evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toMatch(/^rgba?\(255, 255, 255/);
  await page.setViewportSize({ width: 1280, height: 800 });
  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).toBeVisible();
  expect(
    await sidebar.evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toBe("rgb(255, 255, 255)");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
  ).toBe(CREAM);
});
test("客户等级 P0–P2 胶囊统一奶油深一档 #F4E6D4，文字团队主文字色", async ({
  page,
}) => {
  await page.goto("./#/dashboard");
  const chips = page.locator(".tier-chips button.tier-chip");
  await expect(chips.first()).toBeVisible();
  for (const tier of ["P0", "P1", "P2"]) {
    const chip = page.locator(`.tier-chips button.tier-chip.tier-${tier}`);
    await expect(chip).toHaveCount(1);
    const c = chip.first();
    if ((await c.getAttribute("class"))?.includes("selected")) continue;
    expect(await c.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
      "rgb(244, 230, 212)",
    );
    expect(await c.evaluate((e) => getComputedStyle(e).color)).toBe(
      "rgb(43, 33, 28)",
    );
  }
});

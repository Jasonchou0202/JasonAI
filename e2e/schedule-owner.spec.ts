import { test, expect, type Page } from "@playwright/test";
// 日程归属 + 成员颜色 + 头像验收（演示账本，本地运行，全部虚构数据和合成图片）
const instant = "2026-11-12T04:00:00.000Z"; // 北京时间 12:00
// 合成的 1×1 PNG（不是任何人的照片）
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
async function demo(page: Page, role: "admin" | "member", owner = true) {
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript(
    ([role, owner]) => {
      sessionStorage.setItem("zhangyuge-demo", "true");
      sessionStorage.setItem("zhangyuge-demo-role", role as string);
      if (owner) sessionStorage.setItem("zhangyuge-demo-owner", "1");
    },
    [role, owner] as const,
  );
}
const filter = (page: Page) => page.getByRole("group", { name: "按成员看" });
async function openLog(page: Page, title: string) {
  await page.locator(".apple-log-row", { hasText: title }).first().click();
  return page.locator(".apple-log.open .customer-task").first();
}

test("开关关（团队预览、不开日程归属）：没有成员筛选、认领、指派、色点", async ({ page }) => {
  await demo(page, "admin", false);
  await page.goto("./#/calendar");
  await expect(page.getByRole("heading", { name: "跟进日历" })).toBeVisible();
  await expect(filter(page)).toHaveCount(0);
  await expect(page.locator(".m-dot, .m-tag, .m-avatar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "认领" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "指派" })).toHaveCount(0);
  await page.goto("./#/audit");
  await expect(page.getByRole("group", { name: "按操作人" })).toHaveCount(0);
  await expect(page.getByLabel("操作人")).toBeVisible();
});

test("管理员：按成员筛选、月历色点、指派给成员，日志里看到「从谁 → 给谁」", async ({ page }) => {
  await demo(page, "admin");
  await page.goto("./#/calendar");
  await expect(filter(page)).toBeVisible();
  for (const name of ["Jason", "林小雅", "宋阿木", "陈一一"])
    await expect(filter(page).getByRole("button", { name })).toBeVisible();
  // 今天 4 条：4 个色点
  await expect(page.locator(".customer-day.today .m-dot")).toHaveCount(4);
  // 只看 宋阿木
  await filter(page).getByRole("button", { name: "宋阿木" }).click();
  await expect(filter(page).getByRole("button", { name: "宋阿木" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".customer-day.today .m-dot")).toHaveCount(1);
  await filter(page).getByRole("button", { name: "全部" }).click();
  const card = await openLog(page, "Plus 成品号交付");
  await expect(card.getByLabel("日程归属")).toContainText("林小雅");
  await expect(card.getByLabel("日程归属")).toContainText("不同步到 iPhone");
  await card.getByRole("button", { name: "指派" }).click();
  await page.getByRole("list", { name: "指派给谁" }).getByRole("button", { name: /宋阿木/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "日程已指派给宋阿木" })).toBeVisible();
  await page.goto("./#/audit");
  const ops = page.getByRole("group", { name: "按操作人" });
  await expect(ops.getByRole("button", { name: "系统" })).toBeVisible();
  await page.getByRole("group", { name: "按类型" }).getByRole("button", { name: "认领·指派" }).click();
  const row = page.getByRole("table", { name: "操作日志" }).locator("tbody tr").first();
  await expect(row).toContainText("tasks.assign");
  await expect(row.locator(".team-diff")).toContainText("林小雅");
  await expect(row.locator(".team-diff")).toContainText("宋阿木");
  await ops.getByRole("button", { name: "林小雅" }).click();
  await expect(page.getByText("没有符合条件的记录。")).toBeVisible();
});

test("成员：认领 Jason 的日程要先确认「会从 Jason 的 iPhone 删除」；能删别人的；日志只看自己", async ({ page }) => {
  await demo(page, "member");
  await page.goto("./#/calendar");
  await expect(filter(page)).toBeVisible();
  const card = await openLog(page, "确认续费意向");
  await expect(card.getByRole("button", { name: "指派" })).toHaveCount(0);
  await card.getByRole("button", { name: "认领" }).click();
  await expect(page.getByRole("dialog")).toContainText("认领后会从 Jason 的 iPhone 删除");
  await page.getByRole("button", { name: "确认认领" }).click();
  await expect(page.getByRole("status").filter({ hasText: "日程已认领到你名下" })).toBeVisible();
  const other = await openLog(page, "新客报价");
  await other.getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("dialog")).toContainText("只有 Jason 能恢复");
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("status").filter({ hasText: "日程已移入回收站" })).toBeVisible();
  await page.goto("./#/my-log");
  await expect(page.getByText("只能看自己的记录")).toBeVisible();
  const rows = page.getByRole("table", { name: "操作日志" }).locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  await expect(page.getByRole("table", { name: "操作日志" })).toContainText("tasks.claim");
  await expect(page.getByRole("table", { name: "操作日志" })).toContainText("tasks.delete");
});

test("同一个成员各处颜色一致：筛选标签、卡片色条、色点、成员列表", async ({ page }) => {
  await demo(page, "admin");
  await page.goto("./#/calendar");
  await expect(filter(page)).toBeVisible();
  const want: Record<string, string> = { Jason: "#D97757", 林小雅: "#3D5A80", 宋阿木: "#A8781E", 陈一一: "#8A4F7D" };
  for (const [name, dot] of Object.entries(want))
    await expect(filter(page).getByRole("button", { name }).locator(".m-avatar")).toHaveAttribute("data-member-color", dot);
  // 今日卡片：左边色条 = 归属人颜色（色条 Jason 用 #C9603F）
  const bars = await page.locator(".apple-task.has-owner-bar").evaluateAll((els) =>
    els.map((e) => [e.querySelector(".m-tag-name")?.textContent, getComputedStyle(e).borderLeftColor]),
  );
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  expect(bars.length).toBeGreaterThan(0);
  for (const [name, color] of bars) expect(color).toBe(rgb(name === "Jason" ? "#C9603F" : want[name!]));
  const dots = await page.locator(".customer-day.today .m-dot").evaluateAll((els) => els.map((e) => [e.getAttribute("title"), e.getAttribute("data-member-color")]));
  for (const [name, dot] of dots) expect(dot).toBe(want[name!]);
  await page.goto("./#/members");
  await expect(page.getByText("管理员", { exact: true })).toHaveClass(/m-admin-pill/);
  await expect(page.locator("tr", { hasText: "宋阿木" }).locator(".m-avatar")).toHaveAttribute("data-member-color", "#A8781E");
});

test("头像：成员上传（本机压缩成 128px），各处换成图片；清除后恢复默认首字", async ({ page }) => {
  await demo(page, "member");
  await page.goto("./#/calendar");
  await expect(filter(page)).toBeVisible();
  await page.locator(".mini-avatar").click();
  await page.getByLabel("选择头像图片").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByLabel("头像裁切预览，拖动调整位置")).toBeVisible();
  await page.getByRole("button", { name: "保存头像" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const img = filter(page).getByRole("button", { name: "林小雅" }).locator("img");
  await expect(img).toHaveAttribute("src", /^data:image\/(webp|jpeg);base64,/);
  await expect(page.locator(".mini-avatar img")).toBeVisible();
  await page.locator(".mini-avatar").click();
  await page.getByRole("button", { name: "清除头像，恢复默认" }).click();
  await expect(filter(page).getByRole("button", { name: "林小雅" }).locator(".m-avatar")).toHaveText("林");
  // 非图片 / 超过 10MB 在本机就拦下
  await page.locator(".mini-avatar").click();
  await page.getByLabel("选择头像图片").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole("dialog")).toContainText("原图超过 10MB");
});

test("小屏：筛选条只显示头像、可左右滑", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page, "admin");
  await page.goto("./#/calendar");
  await expect(filter(page)).toBeVisible();
  await expect(filter(page).getByRole("button", { name: "宋阿木" }).locator(".m-chip-name")).toBeHidden();
  await filter(page).getByRole("button", { name: "宋阿木" }).click();
  await expect(filter(page).getByRole("button", { name: "宋阿木" }).locator(".m-chip-name")).toBeVisible();
});

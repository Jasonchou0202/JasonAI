import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// 北京时间 2026-10-14 12:00；演示数据会在 10-08 至 10-13 预置 6 天虚构数字，今天留空
const instant = "2026-10-14T04:00:00.000Z";
async function demo(page: Page) {
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript(() =>
    sessionStorage.setItem("zhangyuge-demo", "true"),
  );
}
const form = (page: Page) => page.getByRole("form", { name: "获客录入" });
async function fill(
  page: Page,
  adds: string,
  s: [string, string, string, string],
) {
  await page.getByLabel("当天新增微信好友").fill(adds);
  for (const [i, k] of ["抖音", "视频号", "公众号", "小红书"].entries())
    await page.getByLabel(k, { exact: true }).fill(s[i]);
}

test.describe("今日获客录入（演示模式）", () => {
  test.beforeEach(async ({ page }) => {
    await demo(page);
  });

  test("从侧边栏「内容生产板块」进入，只有一个 h1，面包屑和导航都标在内容板块", async ({
    page,
  }) => {
    await page.goto("./#/dashboard");
    const side = page.getByRole("navigation", { name: "主要导航" });
    await side.getByRole("button", { name: "内容生产板块" }).click();
    await side.getByRole("button", { name: "今日获客录入" }).click();
    await expect(page).toHaveURL(/#\/content-entry$/);
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "今日获客录入",
    );
    await expect(page.locator(".breadcrumb")).toContainText("内容生产板块");
    await expect(
      side.getByRole("button", { name: "今日获客录入" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("complementary", { name: "演示提示" }),
    ).toBeVisible();
    await expect(page.locator(".draft-state")).toHaveText("10月14日还没有录入");
    // 预置的 6 天虚构数字
    await expect(page.locator(".content-table tbody tr")).toHaveCount(6);
  });

  test("四个来源合计对不上不能保存，有清楚的中文提示；对上了才保存，刷新后还在", async ({
    page,
  }) => {
    await page.goto("./#/content-entry");
    await fill(page, "5", ["3", "1", "0", "0"]);
    await expect(page.locator(".content-balance")).toHaveText(
      "四个来源合计 4 人，新增 5 人，还差 1 人对不上",
    );
    await form(page).getByRole("button", { name: "保存这一天" }).click();
    await expect(form(page).getByRole("alert")).toHaveText(
      "四个来源合计 4 人，和当天新增微信好友 5 人对不上，请核对后再保存",
    );
    await expect(page.locator(".content-table tbody tr")).toHaveCount(6);
    await page.getByLabel("小红书", { exact: true }).fill("1");
    await expect(page.locator(".content-balance")).toHaveText(
      "四个来源合计 5 人，和新增人数一致",
    );
    await expect(form(page).getByRole("alert")).toHaveCount(0);
    await form(page).getByRole("button", { name: "保存这一天" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "10月14日的获客已保存" }),
    ).toBeVisible();
    await expect(page.locator(".draft-state")).toHaveText(
      "10月14日已录入 · 第 1 版",
    );
    await expect(page.locator(".content-table tbody tr")).toHaveCount(7);
    await expect(page.locator(".content-table tbody tr").first()).toContainText(
      "10月14日",
    );
    await page.reload();
    await expect(page.locator(".draft-state")).toHaveText(
      "10月14日已录入 · 第 1 版",
    );
    await expect(page.getByLabel("当天新增微信好友")).toHaveValue("5");
    // 改一个数字再保存，版本号 +1
    await fill(page, "6", ["4", "1", "0", "1"]);
    await form(page).getByRole("button", { name: "保存修改" }).click();
    await expect(page.locator(".draft-state")).toHaveText(
      "10月14日已录入 · 第 2 版",
    );
  });

  test("乱填人数也会被拦下", async ({ page }) => {
    await page.goto("./#/content-entry");
    await fill(page, "2", ["1.5", "0", "0", "0"]);
    await expect(page.locator(".content-balance")).toHaveText(
      "人数只能填 0 或正整数",
    );
    await form(page).getByRole("button", { name: "保存这一天" }).click();
    await expect(form(page).getByRole("alert")).toContainText("整数");
  });

  test("删除要确认两次，删除后在「最近删除」里可恢复", async ({ page }) => {
    await page.goto("./#/content-entry");
    const row = page
      .locator(".content-table tbody tr")
      .filter({ hasText: "10月13日" });
    await row.getByRole("button", { name: "删除10月13日" }).click();
    await row.getByRole("button", { name: "确认删除" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "10月13日的记录已删除" }),
    ).toBeVisible();
    await expect(page.locator(".content-table tbody tr")).toHaveCount(5);
    await page.getByRole("button", { name: "恢复10月13日" }).click();
    await expect(page.locator(".content-table tbody tr")).toHaveCount(6);
    await expect(page.locator(".content-deleted")).toHaveCount(0);
  });

  test("「修改」带出那天的数字；未保存的改动会作为草稿保留", async ({
    page,
  }) => {
    await page.goto("./#/content-entry");
    await page.getByRole("button", { name: "修改10月12日" }).click();
    await expect(page.locator("#content-date")).toHaveValue("2026-10-12");
    await expect(page.getByLabel("当天新增微信好友")).toHaveValue("6");
    await expect(page.locator(".draft-state")).toHaveText(
      "10月12日已录入 · 第 1 版",
    );
    await page.getByLabel("抖音", { exact: true }).fill("9");
    await expect(page.locator(".draft-state")).toHaveText(
      "未保存 · 草稿已保留在本机",
    );
    await page.reload();
    await expect(page.getByLabel("抖音", { exact: true })).toHaveValue("9");
    await page.getByRole("button", { name: "撤销改动" }).click();
    await expect(page.getByLabel("抖音", { exact: true })).toHaveValue("5");
  });

  test("断网时保存失败、草稿保留，联网后只保存一次", async ({
    page,
    context,
  }) => {
    await page.goto("./#/content-entry");
    await fill(page, "1", ["1", "0", "0", "0"]);
    await context.setOffline(true);
    await form(page).getByRole("button", { name: "保存这一天" }).click();
    await expect(form(page).getByRole("alert")).toContainText(
      "网络已断开，草稿已保留",
    );
    await context.setOffline(false);
    await form(page).getByRole("button", { name: "保存这一天" }).click();
    await expect(page.locator(".draft-state")).toHaveText(
      "10月14日已录入 · 第 1 版",
    );
    await expect(page.locator(".content-table tbody tr")).toHaveCount(7);
  });

  test("生成可发布汇总：只含日期、人数和四个来源，可下载", async ({ page }) => {
    await page.goto("./#/content-entry");
    const panel = page.getByRole("region", { name: "生成可发布汇总" });
    await panel.getByRole("button", { name: "生成可发布汇总" }).click();
    await expect(panel.getByRole("status")).toHaveText(
      "2026-10-08 至 2026-10-14：共 6 天有记录，合计 34 人",
    );
    const text = await panel.getByLabel("可发布汇总内容").inputValue();
    const x = JSON.parse(text);
    expect(Object.keys(x).sort()).toEqual([
      "daily",
      "exported_at",
      "from",
      "kind",
      "to",
      "version",
    ]);
    for (const d of x.daily) {
      expect(Object.keys(d).sort()).toEqual(["date", "sources", "wechat_adds"]);
      expect(Object.keys(d.sources)).toEqual([
        "抖音",
        "视频号",
        "公众号",
        "小红书",
      ]);
    }
    expect(text).not.toContain("虚构演示数字");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "下载汇总文件" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      "内容获客汇总-2026-10-08至2026-10-14.json",
    );
    expect(JSON.parse(readFileSync((await download.path())!, "utf8"))).toEqual(
      x,
    );
  });

  test("手机 375 宽：不横向溢出，底部「内容生产」里能进入录入", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("./#/dashboard");
    await page
      .getByRole("navigation", { name: "手机导航" })
      .getByRole("button", { name: "内容生产" })
      .click();
    await page
      .locator(".mobile-sheet")
      .getByRole("button", { name: "今日获客录入" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "今日获客录入",
    );
    for (const y of [0, 600, 1200, 2400]) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
    const save = form(page).getByRole("button", { name: "保存这一天" });
    await save.scrollIntoViewIfNeeded();
    const nav = (await page
      .getByRole("navigation", { name: "手机导航" })
      .boundingBox())!;
    const box = (await save.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
  });
});

test("内容数据备份含全部记录和修改记录，和销售备份分开", async ({ page }) => {
  await demo(page);
  await page.goto("./#/content-entry");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载内容数据备份" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("内容数据备份-2026-10-14.json");
  const b = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(b.kind).toBe("content-backup");
  expect(b.sources).toEqual(["抖音", "视频号", "公众号", "小红书"]);
  expect(b.daily).toHaveLength(6);
  expect(Object.keys(b).sort()).toEqual([
    "audit",
    "daily",
    "exportedAt",
    "kind",
    "sources",
    "version",
  ]);
});

test("没登录、没进演示时，打开录入页只看到登录页", async ({ page }) => {
  await page.clock.setFixedTime(new Date(instant));
  await page.goto("./#/content-entry");
  await expect(
    page.getByRole("button", { name: "先看看演示账本" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日获客录入" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("当天新增微信好友")).toHaveCount(0);
});

import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ContentMemoryStore } from "../server/content/memory-store";
import { contentOnly } from "../server/content/guard";
import { executeContent } from "../server/content/service";
import type { PublishableExport } from "../src/domain/content";

// 看板脚本固定用北京时间判断新鲜度；测试里固定「现在」
const env = { ...process.env, BOARD_NOW: "2026-10-19 22:00" };
const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
/** 把看板源码复制到临时目录，避免改到仓库里的 dashboard.json */
function board() {
  const dir = mkdtempSync(join(tmpdir(), "board-"));
  dirs.push(dir);
  cpSync("content-board-src", dir, { recursive: true });
  return dir;
}
function py(dir: string, args: string[]) {
  try {
    return {
      code: 0,
      out: execFileSync("python3", args, { cwd: dir, env, encoding: "utf8" }),
    };
  } catch (e: any) {
    return {
      code: e.status as number,
      out: String(e.stdout) + String(e.stderr),
    };
  }
}
async function realExport(): Promise<PublishableExport> {
  const store = contentOnly(new ContentMemoryStore());
  const ctx = {
    uid: "o",
    ownerUid: "o",
    hash,
    now: () => "2026-10-19T13:40:00.000Z",
  };
  const days = [
    ["2026-10-17", 3, 1, 0, 0],
    ["2026-10-18", 0, 0, 0, 0],
    ["2026-10-19", 2, 1, 1, 1],
  ] as const;
  for (const [date, a, b, c, d] of days)
    await executeContent(store, ctx, "content.daily.save", {
      requestId: "req-" + date,
      date,
      wechat_adds: a + b + c + d,
      leads: { 抖音: a, 视频号: b, 公众号: c, 小红书: d },
      note: "抖音第 88 集带来的",
    });
  return (await executeContent(store, ctx, "content.export.publishable", {
    from: "2026-10-13",
    to: "2026-10-19",
  })) as PublishableExport;
}

describe("可发布汇总 → 看板现有 validate.py / build.py 流程", () => {
  it("main 上的看板：4 个来源，仓库里的 dashboard.json 通过校验", () => {
    const dir = board();
    const r = py(dir, ["validate.py"]);
    expect(r.out).toContain("校验通过");
    const d = JSON.parse(
      readFileSync(join(dir, "data/dashboard.json"), "utf8"),
    );
    expect(d.acquisition.sources.map((s: { key: string }) => s.key)).toEqual([
      "抖音",
      "视频号",
      "公众号",
      "小红书",
    ]);
  });
  it("真实导出的汇总能导入、通过 validate.py、build.py 生成页面", async () => {
    const dir = board();
    const x = await realExport();
    writeFileSync(join(dir, "export.json"), JSON.stringify(x));
    const preview = py(dir, ["import_content_export.py", "export.json"]);
    expect(preview.code).toBe(0);
    expect(preview.out).toContain("新增 3 天");
    expect(preview.out).toContain("预览");
    const w = py(dir, ["import_content_export.py", "export.json", "--write"]);
    expect(w.code).toBe(0);
    const d = JSON.parse(
      readFileSync(join(dir, "data/dashboard.json"), "utf8"),
    );
    expect(d.acquisition.daily).toEqual([
      {
        date: "2026-10-17",
        count: 4,
        sources: { 抖音: 3, 视频号: 1 },
        note: "",
        reported_at: "2026-10-19 21:40",
        reported_by: "章鱼哥录入（生意手账）",
      },
      {
        date: "2026-10-18",
        count: 0,
        sources: {},
        note: "",
        reported_at: "2026-10-19 21:40",
        reported_by: "章鱼哥录入（生意手账）",
      },
      {
        date: "2026-10-19",
        count: 5,
        sources: { 抖音: 2, 视频号: 1, 公众号: 1, 小红书: 1 },
        note: "",
        reported_at: "2026-10-19 21:40",
        reported_by: "章鱼哥录入（生意手账）",
      },
    ]);
    expect(JSON.stringify(d)).not.toContain("第 88 集带来的");
    expect(py(dir, ["validate.py"]).out).toContain("加微记录 3 天");
    const b = py(dir, ["build.py"]);
    expect(b.code).toBe(0);
    const html = readFileSync(join(dir, "dist/index.html"), "utf8");
    // 页面里带上了导入的数字，且不含备注；看板导航保持第二大脑的原样
    expect(html).toContain("章鱼哥录入（生意手账）");
    expect(html).not.toContain("第 88 集带来的");
    expect(html).not.toContain("今日获客录入");
  });
  it("再导一次同一段：云端删掉的那天会从看板移除，改过的会覆盖", async () => {
    const dir = board();
    const x = await realExport();
    writeFileSync(join(dir, "export.json"), JSON.stringify(x));
    py(dir, ["import_content_export.py", "export.json", "--write"]);
    const y = { ...x, daily: x.daily.filter((r) => r.date !== "2026-10-18") };
    y.daily[1] = {
      ...y.daily[1],
      wechat_adds: 6,
      sources: { ...y.daily[1].sources, 抖音: 3 },
    };
    writeFileSync(join(dir, "export.json"), JSON.stringify(y));
    const r = py(dir, ["import_content_export.py", "export.json", "--write"]);
    expect(r.out).toContain("改动 1 天：2026-10-19");
    expect(r.out).toContain("移除 1 天：2026-10-18");
  });
  it.each([
    [
      "多一个字段（备注）",
      (x: any) => (x.daily[0].note = "x"),
      "字段必须正好是",
    ],
    [
      "来源有朋友圈",
      (x: any) => (x.daily[0].sources = { ...x.daily[0].sources, 朋友圈: 0 }),
      "4 个来源",
    ],
    ["合计对不上", (x: any) => (x.daily[0].wechat_adds += 1), "合计"],
    ["顶层多字段", (x: any) => (x.customers = []), "汇总文件字段"],
    ["日期超出范围", (x: any) => (x.daily[0].date = "2026-10-01"), "不在"],
    ["红线词", (x: any) => (x.exported_at = "VPN"), "exported_at"],
  ])("汇总文件有问题（%s）就拒绝，不写入", async (_name, mutate, text) => {
    const dir = board();
    const x = await realExport();
    mutate(x);
    writeFileSync(join(dir, "export.json"), JSON.stringify(x));
    const before = readFileSync(join(dir, "data/dashboard.json"), "utf8");
    const r = py(dir, ["import_content_export.py", "export.json", "--write"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(text);
    expect(readFileSync(join(dir, "data/dashboard.json"), "utf8")).toBe(before);
  });
  it("看板的隐私检查还在：daily 里写名字、来源未知都会被拦下", () => {
    const dir = board();
    const f = join(dir, "data/dashboard.json");
    const d = JSON.parse(readFileSync(f, "utf8"));
    d.acquisition.daily = [
      {
        date: "2026-10-19",
        count: 1,
        sources: { 未知: 1 },
        note: "",
        reported_at: "2026-10-19 21:00",
        reported_by: "章鱼哥报数",
      },
    ];
    writeFileSync(f, JSON.stringify(d));
    expect(py(dir, ["validate.py"]).out).toContain("来源「未知」不认识");
    d.acquisition.daily = [
      {
        date: "2026-10-19",
        count: 1,
        sources: { 抖音: 1 },
        note: "客户名单",
        name: "张三",
        reported_at: "2026-10-19 21:00",
        reported_by: "章鱼哥报数",
      },
    ];
    writeFileSync(f, JSON.stringify(d));
    const r = py(dir, ["validate.py"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/name|客户信息/);
  });
});

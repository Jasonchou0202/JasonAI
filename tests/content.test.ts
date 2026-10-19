import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ContentMemoryStore } from "../server/content/memory-store";
import { contentOnly } from "../server/content/guard";
import { executeContent, type ContentAudit } from "../server/content/service";
import { handleContent } from "../server/content/handler";
import type { ContentContext } from "../server/content/types";
import {
  validateDailyInput,
  type ContentDaily,
  type PublishableExport,
} from "../src/domain/content";

const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
const ctx: ContentContext = {
  uid: "owner-1",
  ownerUid: "owner-1",
  now: () => "2026-10-19T13:30:00.000Z",
  hash,
};
const day = {
  date: "2026-10-19",
  wechat_adds: 6,
  leads: { 抖音: 3, 视频号: 1, 公众号: 2, 小红书: 0 },
  note: "抖音第 88 集",
};
function setup() {
  const raw = new ContentMemoryStore();
  const store = contentOnly(raw);
  const call = <T>(action: string, p: unknown = {}, c = ctx) =>
    executeContent(store, c, action, p) as Promise<T>;
  return { raw, store, call };
}
let n = 0;
const rid = () => `req-${String(++n).padStart(6, "0")}`;

describe("身份", () => {
  it("没绑定所有者、没登录、别人登录都拒绝", async () => {
    const { call } = setup();
    await expect(call("session", {}, { ...ctx, ownerUid: "" })).rejects.toThrow(
      "尚未绑定所有者",
    );
    await expect(call("session", {}, { ...ctx, uid: null })).rejects.toThrow(
      "无权访问",
    );
    await expect(call("session", {}, { ...ctx, uid: "other" })).rejects.toThrow(
      "无权访问",
    );
    await expect(
      call(
        "content.daily.save",
        { ...day, requestId: rid() },
        { ...ctx, uid: "other" },
      ),
    ).rejects.toThrow("无权访问");
    expect(await call("session")).toEqual({ uid: "owner-1" });
  });
  it("handler 先核对身份，报错只回中文短句", async () => {
    const { store } = setup();
    const denied = await handleContent(
      () => store,
      { ...ctx, uid: "x" },
      {
        action: "content.daily.list",
      },
    );
    expect(denied).toEqual({ ok: false, error: "无权访问内容数据" });
    const unknown = await handleContent(() => store, ctx, {
      action: "sales.list",
    });
    expect(unknown).toEqual({ ok: false, error: "不支持这个操作" });
    const bad = await handleContent(() => store, ctx, "x");
    expect(bad.ok).toBe(false);
  });
});

describe("每日录入校验", () => {
  it("四个来源必须正好等于新增人数", () => {
    expect(validateDailyInput(day)).toEqual(day);
    expect(() => validateDailyInput({ ...day, wechat_adds: 7 })).toThrow(
      "四个来源合计 6 人，和当天新增微信好友 7 人对不上",
    );
    expect(() =>
      validateDailyInput({ ...day, leads: { ...day.leads, 抖音: 4 } }),
    ).toThrow("对不上");
  });
  it("只认 4 个来源，缺一个、多一个、负数、小数都拒绝", () => {
    expect(() =>
      validateDailyInput({ ...day, leads: { ...day.leads, 朋友圈: 0 } }),
    ).toThrow("来源「朋友圈」不认识");
    expect(() =>
      validateDailyInput({ ...day, leads: { ...day.leads, 未知: 0 } }),
    ).toThrow("不认识");
    const { 小红书: _, ...three } = day.leads;
    expect(() => validateDailyInput({ ...day, leads: three })).toThrow(
      "小红书人数",
    );
    expect(() =>
      validateDailyInput({ ...day, leads: { ...day.leads, 抖音: -1 } }),
    ).toThrow("整数");
    expect(() => validateDailyInput({ ...day, wechat_adds: 1.5 })).toThrow(
      "整数",
    );
    expect(() => validateDailyInput({ ...day, wechat_adds: "6" })).toThrow(
      "整数",
    );
  });
  it("日期、备注、多余字段", () => {
    expect(() => validateDailyInput({ ...day, date: "2026-02-30" })).toThrow(
      "日期无效",
    );
    expect(() => validateDailyInput({ ...day, note: "字".repeat(61) })).toThrow(
      "最多 60 字",
    );
    expect(() =>
      validateDailyInput({ ...day, note: "加了 13812345678" }),
    ).toThrow("手机号");
    expect(() => validateDailyInput({ ...day, name: "张三" })).toThrow(
      "不认识的字段",
    );
    expect(validateDailyInput({ ...day, note: undefined }).note).toBe("");
  });
  it("云函数同样拒绝合计不对的保存，且不写任何东西", async () => {
    const { call, raw } = setup();
    await expect(
      call("content.daily.save", { ...day, wechat_adds: 5, requestId: rid() }),
    ).rejects.toThrow("对不上");
    expect(raw.data).toEqual({});
  });
});

describe("保存、版本号、软删除、审计、回执", () => {
  it("一天一条：新建 → 修改要带版本号 → 版本不对拒绝", async () => {
    const { call, raw } = setup();
    const a = await call<ContentDaily>("content.daily.save", {
      ...day,
      requestId: rid(),
    });
    expect(a).toMatchObject({
      date: "2026-10-19",
      revision: 1,
      deletedAt: null,
    });
    expect(Object.keys(raw.data.content_daily)).toEqual(["2026-10-19"]);
    await expect(
      call("content.daily.save", { ...day, requestId: rid() }),
    ).rejects.toThrow("已经录过");
    await expect(
      call("content.daily.save", { ...day, revision: 9, requestId: rid() }),
    ).rejects.toThrow("另一处修改");
    const b = await call<ContentDaily>("content.daily.save", {
      ...day,
      wechat_adds: 7,
      leads: { ...day.leads, 小红书: 1 },
      revision: 1,
      requestId: rid(),
    });
    expect(b).toMatchObject({
      revision: 2,
      wechat_adds: 7,
      createdAt: a.createdAt,
    });
    expect(Object.keys(raw.data.content_daily)).toEqual(["2026-10-19"]);
    await expect(
      call("content.daily.save", {
        ...day,
        date: "2026-10-18",
        revision: 1,
        requestId: rid(),
      }),
    ).rejects.toThrow("已不存在");
  });
  it("同一个请求编号重试只生效一次；换内容复用编号被拒绝", async () => {
    const { call, raw } = setup();
    const id = rid();
    const a = await call("content.daily.save", { ...day, requestId: id });
    const again = await call("content.daily.save", { ...day, requestId: id });
    expect(again).toEqual(a);
    expect(Object.keys(raw.data.content_receipts)).toHaveLength(1);
    expect(Object.keys(raw.data.content_audit)).toHaveLength(1);
    await expect(
      call("content.daily.save", { ...day, note: "改了", requestId: id }),
    ).rejects.toThrow("请求编号已用于其他修改");
    await expect(
      call("content.daily.save", { ...day, requestId: "x" }),
    ).rejects.toThrow("请求编号无效");
  });
  it("软删除后列表里看不到，可恢复；删除的那天要先恢复才能改", async () => {
    const { call } = setup();
    await call("content.daily.save", { ...day, requestId: rid() });
    const gone = await call<ContentDaily>("content.daily.delete", {
      date: day.date,
      revision: 1,
      requestId: rid(),
    });
    expect(gone.deletedAt).toBe("2026-10-19T13:30:00.000Z");
    const range = { from: "2026-10-01", to: "2026-10-19" };
    expect(await call("content.daily.list", range)).toEqual([]);
    expect(
      await call<ContentDaily[]>("content.daily.list", {
        ...range,
        deleted: true,
      }),
    ).toHaveLength(1);
    await expect(
      call("content.daily.save", { ...day, revision: 2, requestId: rid() }),
    ).rejects.toThrow("请先恢复");
    await expect(
      call("content.daily.delete", {
        date: day.date,
        revision: 2,
        requestId: rid(),
      }),
    ).rejects.toThrow("已删除");
    const back = await call<ContentDaily>("content.daily.restore", {
      date: day.date,
      revision: 2,
      requestId: rid(),
    });
    expect(back).toMatchObject({
      revision: 3,
      deletedAt: null,
      wechat_adds: 6,
    });
    await expect(
      call("content.daily.restore", {
        date: day.date,
        revision: 3,
        requestId: rid(),
      }),
    ).rejects.toThrow("不用恢复");
    await expect(
      call("content.daily.delete", {
        date: "2026-10-01",
        revision: 1,
        requestId: rid(),
      }),
    ).rejects.toThrow("还没有记录");
  });
  it("每次修改都留审计记录（只有数字，前后对照）", async () => {
    const { call } = setup();
    await call("content.daily.save", { ...day, requestId: rid() });
    await call("content.daily.save", {
      ...day,
      wechat_adds: 7,
      leads: { ...day.leads, 抖音: 4 },
      revision: 1,
      requestId: rid(),
    });
    await call("content.daily.delete", {
      date: day.date,
      revision: 2,
      requestId: rid(),
    });
    const backup = await call<{ audit: ContentAudit[]; daily: ContentDaily[] }>(
      "content.backup",
    );
    const audit = [...backup.audit].sort((a, b) => a.revision - b.revision);
    expect(audit.map((a) => [a.action, a.revision])).toEqual([
      ["save", 1],
      ["save", 2],
      ["delete", 3],
    ]);
    expect(audit[0].before).toBeNull();
    expect(audit[1].before?.wechat_adds).toBe(6);
    expect(audit[1].after.wechat_adds).toBe(7);
    expect(audit[2].after.deletedAt).not.toBeNull();
    expect(backup.daily).toHaveLength(1);
  });
  it("失败的事务整体回滚，不留回执和审计", async () => {
    const { call, raw } = setup();
    await call("content.daily.save", { ...day, requestId: rid() });
    const before = structuredClone(raw.data);
    await expect(
      call("content.daily.save", { ...day, revision: 5, requestId: rid() }),
    ).rejects.toThrow();
    expect(raw.data).toEqual(before);
  });
});

describe("查询和可发布汇总", () => {
  it("列表按日期范围、最多 400 天", async () => {
    const { call } = setup();
    for (const date of ["2026-10-17", "2026-10-18", "2026-10-19"])
      await call("content.daily.save", { ...day, date, requestId: rid() });
    const rows = await call<ContentDaily[]>("content.daily.list", {
      from: "2026-10-18",
      to: "2026-10-19",
    });
    expect(rows.map((r) => r.date)).toEqual(["2026-10-18", "2026-10-19"]);
    await expect(
      call("content.daily.list", { from: "2025-01-01", to: "2026-10-19" }),
    ).rejects.toThrow("最多查 400 天");
    await expect(
      call("content.daily.list", { from: "2026-10-19", to: "2026-10-01" }),
    ).rejects.toThrow("不能晚于");
  });
  it("汇总只含日期、人数、4 个来源；不含备注和已删除的天", async () => {
    const { call } = setup();
    await call("content.daily.save", {
      ...day,
      date: "2026-10-18",
      requestId: rid(),
    });
    await call("content.daily.save", { ...day, requestId: rid() });
    await call("content.daily.delete", {
      date: "2026-10-18",
      revision: 1,
      requestId: rid(),
    });
    const x = await call<PublishableExport>("content.export.publishable", {
      from: "2026-10-13",
      to: "2026-10-19",
    });
    expect(x).toEqual({
      kind: "content-daily-export",
      version: 1,
      from: "2026-10-13",
      to: "2026-10-19",
      exported_at: "2026-10-19 21:30",
      daily: [
        {
          date: "2026-10-19",
          wechat_adds: 6,
          sources: { 抖音: 3, 视频号: 1, 公众号: 2, 小红书: 0 },
        },
      ],
    });
    expect(JSON.stringify(x)).not.toContain("抖音第 88 集");
  });
});

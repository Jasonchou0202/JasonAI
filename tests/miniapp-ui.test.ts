import { describe, expect, it } from "vitest";
import {
  compareFlags,
  isMiniappHiddenError,
  isMiniappMember,
  salesFlagsFromMe,
  UNCOMPARABLE_FLAG_LABELS,
  bjDateText,
  formatAdminPhone,
} from "../src/lib/miniapp-api";
import { ApiError, LEGACY_ME } from "../src/lib/team-me";
import { createDemoMiniapp, resetDemoMiniapp } from "../src/lib/miniapp-demo";

describe("两边开关核对", () => {
  it("members.me 缺省项按关，和小程序侧逐项对照，只比较网页已能看到的开关", () => {
    const sales = salesFlagsFromMe({ ...LEGACY_ME, membersEnabled: true, auditEnabled: true });
    expect(sales).toEqual({
      membersEnabled: true,
      auditEnabled: true,
      scheduleOwnerEnabled: false,
      avatarsEnabled: false,
      expensesEnabled: false,
      salesPayerEnabled: false,
      invoiceEnabled: false,
    });
    const same = compareFlags(sales, sales);
    expect(same.ok).toBe(true);
    expect(same.rows.every((r) => r.match)).toBe(true);
    expect(same.rows.find((r) => r.key === "membersEnabled")).toMatchObject({ label: "成员功能", sales: true, miniapp: true });
    expect(same.rows.find((r) => r.key === "invoiceEnabled")).toMatchObject({ label: "开票", sales: false, miniapp: false });
  });

  it("不一致时标出网页开/关与小程序开/关，不带环境变量名", () => {
    const sales = salesFlagsFromMe({ ...LEGACY_ME, membersEnabled: true, auditEnabled: false, invoiceEnabled: true });
    const diff = compareFlags(sales, {
      membersEnabled: true,
      auditEnabled: true,
      scheduleOwnerEnabled: false,
      avatarsEnabled: false,
      expensesEnabled: false,
      salesPayerEnabled: false,
      invoiceEnabled: false,
    });
    expect(diff.ok).toBe(false);
    const audit = diff.rows.find((r) => r.key === "auditEnabled")!;
    const invoice = diff.rows.find((r) => r.key === "invoiceEnabled")!;
    expect(audit).toMatchObject({ match: false, sales: false, miniapp: true, label: "操作日志" });
    expect(invoice).toMatchObject({ match: false, sales: true, miniapp: false, label: "开票" });
    expect(JSON.stringify(diff)).not.toMatch(/MEMBERS_ENABLED|INVOICE_ENABLED|OWNER_UID/);
  });

  it("销售录入人、报销凭证、续费提醒不进入对照表", () => {
    expect(UNCOMPARABLE_FLAG_LABELS).toEqual(["销售录入人", "报销凭证", "续费提醒"]);
    const rows = compareFlags(salesFlagsFromMe(LEGACY_ME), salesFlagsFromMe(LEGACY_ME)).rows.map((r) => r.key);
    expect(rows).not.toContain("salesActorFieldsEnabled");
    expect(rows).not.toContain("expenseReceiptsEnabled");
    expect(rows).not.toContain("expenseRenewEnabled");
  });
});

describe("入口隐藏条件", () => {
  it("开关关、函数不存在时隐藏；登录失效不按这个规则判断", () => {
    expect(isMiniappHiddenError(new ApiError("小程序功能未开启", "MINIAPP_OFF"))).toBe(true);
    expect(isMiniappHiddenError(new ApiError("函数不存在", "FUNCTION_NOT_FOUND"))).toBe(true);
    expect(isMiniappHiddenError(new ApiError("x", "function-notexist"))).toBe(true);
    expect(isMiniappHiddenError(new Error("cloud function does not exist"))).toBe(true);
    expect(isMiniappHiddenError(new ApiError("登录已过期，请重新登录", "NOT_SIGNED_IN"))).toBe(false);
    expect(isMiniappHiddenError(new ApiError("这个操作只有管理员可以进行", "ADMIN_ONLY"))).toBe(false);
  });
});

describe("小程序成员标签", () => {
  it("inviteId 为 miniapp 或 uid 以 wx_ 开头的算小程序成员", () => {
    expect(isMiniappMember({ uid: "u1", inviteId: "miniapp" })).toBe(true);
    expect(isMiniappMember({ uid: "wx_abc", inviteId: "inv_x" })).toBe(true);
    expect(isMiniappMember({ uid: "demo-member", inviteId: "demo" })).toBe(false);
    expect(isMiniappMember({ uid: "demo-member" })).toBe(false);
  });
});


describe("示例绑定数据（虚构）", () => {
  it("生成 8 位不含易混字符的绑定码，并列出待批申请", async () => {
    resetDemoMiniapp();
    const api = createDemoMiniapp();
    const flags = await api.call<{ miniappEnabled: boolean; membersEnabled: boolean }>("miniapp.flags");
    expect(flags.miniappEnabled).toBe(true);
    expect(flags.membersEnabled).toBe(true);
    const code = await api.call<{ code: string; expiresAt: string }>("miniapp.owner.code");
    expect(code.code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(Date.parse(code.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    const list = await api.call<{ pending: { name: string; phone: string }[] }>("miniapp.apply.list");
    expect(list.pending.map((a) => a.name)).toContain("示例申请人 · 阿杰");
    expect(list.pending.some((a) => a.phone === "13800001111")).toBe(true);
    await api.call("miniapp.apply.reject", { id: "a_1111111111111111111111111111111111111111" });
    const after = await api.call<{ pending: { id: string }[]; rejected: { id: string }[] }>("miniapp.apply.list");
    expect(after.pending.some((a) => a.id.startsWith("a_1111"))).toBe(false);
    expect(after.rejected.some((a) => a.id.startsWith("a_1111"))).toBe(true);
  });
});


describe("预览排版", () => {
  it("北京时间写成月日，手机号分组，不把数字粘在一起", () => {
    expect(bjDateText("2026-11-18T07:05:00.000Z")).toBe("11月18日 15:05");
    expect(formatAdminPhone("13800001111")).toBe("138 0000 1111");
    expect(formatAdminPhone("137****3333")).toBe("137 **** 3333");
  });
});

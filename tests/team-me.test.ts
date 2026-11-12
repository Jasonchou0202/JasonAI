import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Api } from "../src/domain/model";
import {
  ApiError,
  LEGACY_ME,
  errorCode,
  isAuthError,
  isFeatureOffError,
  visibleMe,
  whoAmI,
} from "../src/lib/team-me";
import { MemoryStore } from "../server/memory-store";
import { handle } from "../server/handler";
import type { Context } from "../server/service";
import type { TeamConfig } from "../server/team";

function api(impl: (action: string) => unknown): Api {
  return { call: async (action) => impl(action) as never };
}

describe("errorCode / isFeatureOffError / isAuthError", () => {
  it("只取合法错误码，非法值忽略", () => {
    expect(errorCode(new ApiError("x", "NOT_SIGNED_IN"))).toBe("NOT_SIGNED_IN");
    expect(errorCode(new Error("不支持的操作"))).toBeUndefined();
    expect(errorCode({ code: "有中文" })).toBeUndefined();
    expect(errorCode({ code: "a".repeat(101) })).toBeUndefined();
    expect(errorCode({ code: 401 })).toBeUndefined();
  });

  it("无错误码且文案为「不支持的操作」视为功能未开；有别的码则不认", () => {
    expect(isFeatureOffError(new Error("不支持的操作"))).toBe(true);
    expect(isFeatureOffError(new ApiError("不支持的操作"))).toBe(true);
    expect(isFeatureOffError(new ApiError("不支持的操作", "NOT_SIGNED_IN"))).toBe(false);
    expect(isFeatureOffError(new Error("网络已断开，草稿已保留，请联网后重试"))).toBe(false);
    expect(isFeatureOffError(new ApiError("x", "NOT_SIGNED_IN"))).toBe(false);
  });

  it("UNSUPPORTED_ACTION 视为功能未开（大小写/连字符归一），文案无关", () => {
    expect(isFeatureOffError(new ApiError("不支持的操作", "UNSUPPORTED_ACTION"))).toBe(true);
    expect(isFeatureOffError(new ApiError("别的提示", "UNSUPPORTED_ACTION"))).toBe(true);
    expect(isFeatureOffError({ code: "unsupported-action" })).toBe(true);
    expect(isFeatureOffError(new ApiError("不支持的操作", "UNSUPPORTED"))).toBe(false);
    expect(isAuthError(new ApiError("不支持的操作", "UNSUPPORTED_ACTION"))).toBe(false);
  });

  it("登录失效只认服务端实际返回的 NOT_SIGNED_IN", () => {
    expect(isAuthError(new ApiError("无权访问这个私人账本", "NOT_SIGNED_IN"))).toBe(true);
    expect(isAuthError({ code: "not_signed_in" })).toBe(true);
    expect(isAuthError({ code: "not_login" })).toBe(false);
    expect(isAuthError({ code: "SESSION_EXPIRED" })).toBe(false);
    expect(isAuthError(new Error("登录已过期，请重新登录"))).toBe(false);
    expect(isAuthError(new Error("不支持的操作"))).toBe(false);
  });
});

describe("visibleMe", () => {
  it("未就绪时角色为 none，不露出管理员入口", () => {
    const admin: typeof LEGACY_ME = { ...LEGACY_ME, role: "admin", membersEnabled: true, auditEnabled: true };
    expect(visibleMe(admin, false)).toEqual({ ...LEGACY_ME, role: "none" });
    expect(visibleMe(admin, true)).toEqual(admin);
  });
});

describe("whoAmI", () => {
  it("成功时带回云端身份（功能已开）", async () => {
    const result = await whoAmI(
      api(() => ({
        uid: "u1",
        role: "admin",
        name: "章鱼哥",
        status: "active",
        membersEnabled: true,
        auditEnabled: true,
      })),
    );
    expect(result).toEqual({
      status: "ok",
      me: {
        ...LEGACY_ME,
        uid: "u1",
        role: "admin",
        name: "章鱼哥",
        status: "active",
        membersEnabled: true,
        auditEnabled: true,
      },
    });
  });

  it("成功但开关关闭：用返回里的开关字段，明确功能未开", async () => {
    const result = await whoAmI(
      api(() => ({
        uid: "u1",
        role: "admin",
        name: "章鱼哥",
        status: "active",
        membersEnabled: false,
        auditEnabled: false,
      })),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.me.membersEnabled).toBe(false);
    expect(result.me.auditEnabled).toBe(false);
  });

  it("带 UNSUPPORTED_ACTION 码视为功能明确未开（新云函数开关全关）", async () => {
    const result = await whoAmI(
      api(() => {
        throw new ApiError("不支持的操作", "UNSUPPORTED_ACTION");
      }),
    );
    expect(result).toEqual({ status: "ok", me: LEGACY_ME });
  });

  it("没有错误码的「不支持的操作」视为功能明确未开（线上开关全关）", async () => {
    const result = await whoAmI(
      api(() => {
        throw new Error("不支持的操作");
      }),
    );
    expect(result).toEqual({ status: "ok", me: LEGACY_ME });
  });

  it("NOT_SIGNED_IN 视为登录已过期，不是暂时连不上，也不是功能未开", async () => {
    const result = await whoAmI(
      api(() => {
        throw new ApiError("无权访问这个私人账本", "NOT_SIGNED_IN");
      }),
    );
    expect(result).toEqual({ status: "unauthenticated" });
  });

  it("网络断开视为暂时连不上，不假装成未开或过期", async () => {
    const result = await whoAmI(
      api(() => {
        throw new Error("网络已断开，草稿已保留，请联网后重试");
      }),
    );
    expect(result).toEqual({ status: "unavailable" });
  });

  it("fetch / timeout 等连接失败视为暂时连不上", async () => {
    for (const message of ["Failed to fetch", "network error", "timeout", "timed out"]) {
      const result = await whoAmI(
        api(() => {
          throw new Error(message);
        }),
      );
      expect(result, message).toEqual({ status: "unavailable" });
    }
  });
});

describe("whoAmI 经真实 sales handler（不部署）", () => {
  const OWNER = "uid-owner";
  const NOW = "2026-11-12T04:00:00.000Z";
  const hash = async (s: string) => createHash("sha256").update(s).digest("hex");
  const ctx: Context = { uid: OWNER, ownerUid: OWNER, now: () => NOW, hash };

  /** 与前端 cloud.ts 一样：把 handler 的 { ok, error, code } 转成 ApiError / 数据 */
  function apiFromHandle(team?: TeamConfig): Api {
    const store = new MemoryStore();
    return {
      async call<T>(action: string, payload: unknown = {}) {
        const r = (await handle(
          () => store,
          ctx,
          { action, payload },
          undefined,
          undefined,
          team,
        )) as { ok: boolean; data?: unknown; error?: string; code?: string };
        if (!r.ok) {
          const code =
            typeof r.code === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(r.code) ? r.code : undefined;
          throw new ApiError(r.error || "操作未完成", code);
        }
        return r.data as T;
      },
    };
  }

  async function rawMembersMe(team?: TeamConfig) {
    const store = new MemoryStore();
    return handle(() => store, ctx, { action: "members.me", payload: {} }, undefined, undefined, team);
  }

  it("开关全关：handler 返回 code UNSUPPORTED_ACTION、文案仍是「不支持的操作」，whoAmI 为单人管理员", async () => {
    const raw = await rawMembersMe({ membersEnabled: false, auditEnabled: false });
    expect(raw).toEqual({ ok: false, code: "UNSUPPORTED_ACTION", error: "不支持的操作" });
    const result = await whoAmI(apiFromHandle({ membersEnabled: false, auditEnabled: false }));
    expect(result).toEqual({ status: "ok", me: LEGACY_ME });
  });

  it("不传开关：与开关全关相同（UNSUPPORTED_ACTION + 原文案），whoAmI 为单人管理员", async () => {
    const raw = await rawMembersMe(undefined);
    expect(raw).toEqual({ ok: false, code: "UNSUPPORTED_ACTION", error: "不支持的操作" });
    const result = await whoAmI(apiFromHandle(undefined));
    expect(result).toEqual({ status: "ok", me: LEGACY_ME });
  });
});

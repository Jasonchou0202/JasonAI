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

function api(impl: (action: string) => unknown): Api {
  return { call: async (action) => impl(action) as never };
}

describe("errorCode / isFeatureOffError / isAuthError", () => {
  it("只取合法错误码，非法值忽略", () => {
    expect(errorCode(new ApiError("x", "UNSUPPORTED_ACTION"))).toBe("UNSUPPORTED_ACTION");
    expect(errorCode({ code: "not_login" })).toBe("not_login");
    expect(errorCode(new Error("不支持的操作"))).toBeUndefined();
    expect(errorCode({ code: "有中文" })).toBeUndefined();
    expect(errorCode({ code: "a".repeat(101) })).toBeUndefined();
    expect(errorCode({ code: 401 })).toBeUndefined();
  });

  it("功能未开只认错误码，不比对中文", () => {
    expect(isFeatureOffError(new ApiError("不支持的操作", "UNSUPPORTED_ACTION"))).toBe(true);
    expect(isFeatureOffError(new ApiError("anything", "feature-off"))).toBe(true);
    expect(isFeatureOffError(new ApiError("不支持的操作"))).toBe(false);
    expect(isFeatureOffError(new Error("不支持的操作"))).toBe(false);
    expect(isFeatureOffError(new ApiError("x", "NOT_SIGNED_IN"))).toBe(false);
  });

  it("登录失效只认错误码", () => {
    expect(isAuthError(new ApiError("登录已过期，请重新登录", "NOT_SIGNED_IN"))).toBe(true);
    expect(isAuthError({ code: "not_login" })).toBe(true);
    expect(isAuthError({ code: "SESSION_EXPIRED" })).toBe(true);
    expect(isAuthError(new Error("登录已过期，请重新登录"))).toBe(false);
    expect(isAuthError(new ApiError("x", "UNSUPPORTED_ACTION"))).toBe(false);
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

  it("错误码 UNSUPPORTED_ACTION 视为功能明确未开（旧后台）", async () => {
    const result = await whoAmI(
      api(() => {
        throw new ApiError("不支持的操作", "UNSUPPORTED_ACTION");
      }),
    );
    expect(result).toEqual({ status: "ok", me: LEGACY_ME });
  });

  it("没有错误码的中文「不支持的操作」不再当成未开", async () => {
    const result = await whoAmI(
      api(() => {
        throw new Error("不支持的操作");
      }),
    );
    expect(result).toEqual({ status: "unavailable" });
  });

  it("NOT_SIGNED_IN 视为登录已过期，不是暂时连不上", async () => {
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

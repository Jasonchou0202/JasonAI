import { describe, expect, it } from "vitest";
import type { Api } from "../src/domain/model";
import { LEGACY_ME, isFeatureOffError, whoAmI } from "../src/lib/team-me";

function api(impl: (action: string) => unknown): Api {
  return { call: async (action) => impl(action) as never };
}

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

  it("成功但开关关闭：明确功能未开", async () => {
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

  it("「不支持的操作」视为功能明确未开（旧后台 / 普通演示）", async () => {
    const result = await whoAmI(
      api(() => {
        throw new Error("不支持的操作");
      }),
    );
    expect(result).toEqual({ status: "ok", me: LEGACY_ME });
    expect(isFeatureOffError(new Error("不支持的操作"))).toBe(true);
  });

  it("网络断开视为暂时连不上，不假装成未开", async () => {
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

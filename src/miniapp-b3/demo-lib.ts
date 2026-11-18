/**
 * 小程序「看示例数据」（第 3 批，方案对照表 16）：复用网页同一份示例数据生成器 createDemo()，
 * 构建成 miniprogram/pkg-demo/lib/demo-lib.js。进入示例后，小程序里所有 wx.cloud.callFunction 都改由本机示例账本回答，
 * 一条请求也不发到云端；退出示例就还原。只给已批准的人（入口页先查 miniapp.me）。
 */
import "./shims";
import { createDemo } from "../lib/demo";
import type { Api } from "../domain/model";

export type DemoRole = "admin" | "member";
type CallArgs = { name?: string; data?: { action?: unknown; payload?: unknown } };
type Wx = { cloud: { callFunction: (o: CallArgs) => Promise<unknown> } };
let original: Wx["cloud"]["callFunction"] | null = null;
let api: Api | null = null;
let role: DemoRole = "admin";

/** 示例模式下怎么回答一个调用（纯函数，单测直接测这里） */
export async function demoAnswer(demo: Api, as: DemoRole, action: unknown, payload: unknown) {
  if (typeof action !== "string") return { ok: false, error: "请求格式无效" };
  if (action === "miniapp.me")
    return {
      ok: true,
      data: { enabled: true, membersEnabled: true, status: as === "admin" ? "owner" : "member", role: as === "admin" ? "admin" : "member", name: as === "admin" ? "示例管理员" : "示例成员", demo: true },
    };
  if (action.startsWith("miniapp.") || action.startsWith("content.") || action.startsWith("push."))
    return { ok: false, code: "DEMO_ONLY", error: "示例数据里不能做这个操作" };
  try {
    return { ok: true, data: await demo.call(action, payload ?? {}) };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return { ok: false, ...(err.code ? { code: err.code } : {}), error: err.message || "操作未完成" };
  }
}
export function enterDemo(wx: Wx, as: DemoRole = "admin") {
  role = as;
  api = createDemo(as);
  if (!original) original = wx.cloud.callFunction;
  const patched = async (o: CallArgs) => ({ result: await demoAnswer(api!, role, o?.data?.action, o?.data?.payload), requestID: "demo" });
  try {
    wx.cloud.callFunction = patched;
  } catch {
    /* 有的基础库属性只读：下面再试 defineProperty */
  }
  if (wx.cloud.callFunction !== patched)
    try {
      Object.defineProperty(wx.cloud, "callFunction", { value: patched, configurable: true, writable: true });
    } catch {
      /* 交给下面的检查 */
    }
  if (wx.cloud.callFunction !== patched) {
    exitDemo(wx);
    throw new Error("这台手机的微信版本暂不支持示例数据");
  }
}
export function exitDemo(wx: Wx) {
  const back = original;
  original = null;
  api = null;
  if (!back || wx.cloud.callFunction === back) return;
  try {
    wx.cloud.callFunction = back;
  } catch {
    /* 只读：下面再试 */
  }
  if (wx.cloud.callFunction !== back)
    try {
      Object.defineProperty(wx.cloud, "callFunction", { value: back, configurable: true, writable: true });
    } catch {
      /* 改不回来就算了：进不了示例的手机，本来也没改动过 */
    }
}
export const inDemo = () => !!original;
export const demoRole = () => role;

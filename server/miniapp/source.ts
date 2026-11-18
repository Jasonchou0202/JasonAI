/**
 * 来源校验（腾讯云工单 202611183460 第 5 点：同一函数兼做网页/HTTP 时要解析来源，防身份串用）。
 * - 小程序来源：平台上下文里有合法 openid + 合法 appid（wx.cloud.callFunction 由微信注入，伪造不了）；appid 须等于 MINIAPP_APPID。
 * - 网页来源：没有 openid 时，用 CloudBase 登录 uid（js-sdk 的 getAuthContext）。环境已关联小程序时，网页调用也可能带上 WX_APPID；只有 appid、没有 openid 时按网页来源处理，不能直接报错。
 * - 有 openid 但格式非法的仍然拒绝。HTTP 形态的请求一律拒绝：miniapp 函数不开 HTTP 路由，就算误开了也进不来。
 * - 请求体里的 userInfo / openid / uid 一律不看。
 */
import type { Source } from "./types";

export interface PlatformIdentity {
  openid?: string;
  appid?: string;
  uid?: string;
}
export class SourceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
const OPENID = /^[\w-]{6,64}$/;
const APPID = /^wx[0-9a-f]{16}$/;
const UID = /^[\w-]{1,128}$/;

/** 看起来像 HTTP 访问服务转进来的请求 */
export function looksLikeHttp(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  return "httpMethod" in e || "headers" in e || "requestContext" in e || "isBase64Encoded" in e;
}

export function isValidOpenid(value?: string): boolean {
  return typeof value === "string" && OPENID.test(value);
}

export function resolveSource(event: unknown, platform: PlatformIdentity, expectedAppId?: string): Source {
  if (looksLikeHttp(event)) throw new SourceError("HTTP_NOT_ALLOWED", "这个入口不接受网页链接访问");
  const openid = platform.openid || "";
  const appid = platform.appid || "";
  // 只有 openid 合法才走小程序来源；裸 appid（环境关联小程序后网页 js-sdk 常会带上）不能当成小程序。
  if (openid) {
    if (!isValidOpenid(openid) || !APPID.test(appid)) throw new SourceError("SOURCE_INVALID", "无法识别调用来源");
    if (expectedAppId && appid !== expectedAppId) throw new SourceError("APPID_MISMATCH", "不是生意手账小程序的调用");
    return { kind: "miniapp", openid, appid };
  }
  const uid = platform.uid || "";
  if (uid && UID.test(uid)) return { kind: "web", uid };
  throw new SourceError("NOT_SIGNED_IN", "无法识别调用来源");
}

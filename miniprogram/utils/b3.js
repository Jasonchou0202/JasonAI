// 第 3 批各分包共用的小工具（新文件；只读取第 1 批的 utils/api.js，不改它）
const { call } = require("./api");

/** 超过 90KB 的大字段走 wx.cloud.CDN（官方建议 100KB 以上用 CDN），云函数收到的是临时地址 */
const INLINE_MAX = 90 * 1024;
function bigField(text, inlineKey, urlKey) {
  if (text.length <= INLINE_MAX || !wx.cloud.CDN) return { [inlineKey]: text };
  return { [urlKey]: wx.cloud.CDN(text) };
}
/** 分转元，千分位 */
function money(cents) {
  const n = Math.round(Number(cents) || 0) / 100;
  const s = Math.abs(n).toFixed(n % 1 ? 2 : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-¥" : "¥") + s;
}
/** 北京时间今天 YYYY-MM-DD */
function bjToday(now) {
  const d = new Date((now || Date.now()) + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function bjAddDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 8～128 位请求编号（content 函数防重复提交） */
function requestId() {
  let s = "mp";
  for (let i = 0; i < 24; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
  return s;
}
/** 查自己的身份：owner / member；其他一律回到入口页 */
function whoAmI() {
  return call("miniapp.me").then((me) => {
    if (me.status !== "owner" && me.status !== "member") {
      wx.reLaunch({ url: "/pages/gate/index" });
      throw new Error("无权限");
    }
    return { admin: me.status === "owner", name: me.name || "", demo: !!me.demo };
  });
}
function demoState() {
  const app = getApp();
  return (app && app.globalData && app.globalData.demo) || null;
}
/** 截屏、录屏时遮盖（Android），和第 1 批首页一样 */
function hideOnCapture(on) {
  if (wx.setVisualEffectOnCapture) wx.setVisualEffectOnCapture({ visualEffect: on ? "hidden" : "none" });
}
module.exports = { call, bigField, money, bjToday, bjAddDays, requestId, whoAmI, demoState, hideOnCapture, INLINE_MAX };

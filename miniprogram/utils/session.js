// 进入数据页前确认身份：miniapp.me（绑定状态）+ members.me（角色和开关）。
// 只放内存，不写本机缓存（方案对照表第 14 行：本机只缓存草稿，不缓存账本数据）。
const { call } = require("./api");
let cached = null;
let at = 0;
const LEGACY_ADMIN = { uid: "", role: "admin", name: "管理员", status: "active" };

function load(force) {
  if (!force && cached && Date.now() - at < 60000) return Promise.resolve(cached);
  return call("miniapp.me").then((bind) => {
    if (bind.status !== "owner" && bind.status !== "member") {
      cached = null;
      wx.reLaunch({ url: "/pages/gate/index" });
      const e = new Error("请先完成绑定");
      e.code = "NOT_BOUND";
      throw e;
    }
    return call("members.me")
      .catch(() => (bind.status === "owner" ? LEGACY_ADMIN : Promise.reject(new Error("无权限"))))
      .then((me) => {
        cached = Object.assign({}, me, { owner: bind.status === "owner", bindName: bind.name || "", avatarUrl: bind.avatarUrl || "" });
        at = Date.now();
        return cached;
      });
  });
}
function clear() {
  cached = null;
}
// 私密账本：安卓上截屏、录屏时遮盖；离开页面恢复
function protect(on) {
  if (wx.setVisualEffectOnCapture) wx.setVisualEffectOnCapture({ visualEffect: on ? "hidden" : "none" });
}
module.exports = { load, clear, protect };

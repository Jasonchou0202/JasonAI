// 第 1 批骨架：确认身份后的首页占位。看板、记一笔、明细、日程、铃铛在第 1 批后续补上。
const { call } = require("../../utils/api");
Page({
  data: { role: "", name: "", error: "" },
  onShow() {
    if (wx.setVisualEffectOnCapture) wx.setVisualEffectOnCapture({ visualEffect: "hidden" });
    this.load();
  },
  onHide() {
    if (wx.setVisualEffectOnCapture) wx.setVisualEffectOnCapture({ visualEffect: "none" });
  },
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
  load() {
    return call("miniapp.me")
      .then((me) => {
        if (me.status !== "owner" && me.status !== "member") return wx.reLaunch({ url: "/pages/gate/index" });
        this.setData({ role: me.status === "owner" ? "管理员" : "成员", name: me.name || "", error: "" });
      })
      .catch((e) => this.setData({ error: e.message }));
  },
  leave() {
    wx.showModal({
      title: "退出小程序账号",
      content: "退出后这个微信要重新申请才能使用，确定吗？",
      success: (r) =>
        r.confirm &&
        call("miniapp.bind.leave").then(() => wx.reLaunch({ url: "/pages/gate/index" })).catch((e) => this.setData({ error: e.message })),
    });
  },
});

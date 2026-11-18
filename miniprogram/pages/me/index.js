// 我的：身份、成员申请入口（只给管理员，带红点）、退出这个微信的绑定
const { call } = require("../../utils/api");
const session = require("../../utils/session");

Page({
  data: { role: "", name: "", owner: false, pending: 0, error: "" },
  onShow() {
    session
      .load(true)
      .then((me) => {
        this.setData({ role: me.role === "admin" ? "管理员" : "成员", name: me.bindName || me.name || "", owner: me.owner, error: "" });
        if (me.owner)
          return call("miniapp.apply.list")
            .then((r) => {
              const n = ((r && r.pending) || []).length;
              this.setData({ pending: n });
              if (n) wx.setTabBarBadge({ index: 3, text: String(n) });
              else wx.removeTabBarBadge({ index: 3 });
            })
            .catch(() => {});
      })
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ error: e.message });
      });
  },
  applications() {
    wx.navigateTo({ url: "/pages/applications/index" });
  },
  leave() {
    wx.showModal({
      title: "退出小程序账号",
      content: "退出后这个微信要重新申请才能使用，确定吗？",
      confirmColor: "#9E2A1E",
      success: (r) =>
        r.confirm &&
        call("miniapp.bind.leave")
          .then(() => {
            session.clear();
            wx.reLaunch({ url: "/pages/gate/index" });
          })
          .catch((e) => this.setData({ error: e.message })),
    });
  },
});

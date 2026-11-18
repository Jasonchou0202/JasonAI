// 看示例数据（方案对照表 16）：只给已批准的人（先查真实身份）。进入后所有云函数调用由本机示例账本回答
const demo = require("../lib/demo-lib.js");
const { call } = require("../../utils/api");
Page({
  data: { role: "admin", active: "", allowed: false, error: "" },
  onShow() {
    const d = getApp().globalData.demo;
    this.setData({ active: d ? d.role : "" });
    if (d) return;
    call("miniapp.me")
      .then((me) => {
        const ok = me.status === "owner" || me.status === "member";
        if (!ok) return wx.reLaunch({ url: "/pages/gate/index" });
        this.setData({ allowed: true, role: me.status === "owner" ? "admin" : "member" });
      })
      .catch((e) => this.setData({ error: e.message }));
  },
  setRole(e) {
    this.setData({ role: e.currentTarget.dataset.role });
  },
  enter() {
    if (!this.data.allowed) return;
    try {
      demo.enterDemo(wx, this.data.role);
    } catch (e) {
      return this.setData({ error: e.message });
    }
    getApp().globalData.demo = { role: this.data.role };
    wx.reLaunch({ url: "/pages/home/index" });
  },
  exit() {
    demo.exitDemo(wx);
    getApp().globalData.demo = null;
    wx.reLaunch({ url: "/pages/gate/index" });
  },
});

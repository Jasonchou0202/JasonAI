// 入口分流：按云端 miniapp.me 的状态去对应页面；本机不缓存身份
const { call } = require("../../utils/api");
const ROUTES = {
  owner: "/pages/home/index",
  member: "/pages/home/index",
  none: "/pages/apply/index",
  pending: "/pages/apply/index",
  rejected: "/pages/apply/index",
};
Page({
  data: { loading: true, error: "" },
  onShow() {
    this.route();
  },
  onPullDownRefresh() {
    this.route().then(() => wx.stopPullDownRefresh());
  },
  route() {
    this.setData({ loading: true, error: "" });
    return call("miniapp.me")
      .then((me) => {
        const url = ROUTES[me.status] || "/pages/denied/index";
        wx.reLaunch({ url: url + "?status=" + encodeURIComponent(me.status) });
      })
      .catch((e) => {
        if (e.code === "NO_ACCESS" || e.code === "MINIAPP_OFF")
          return wx.reLaunch({ url: "/pages/denied/index?status=" + e.code });
        this.setData({ loading: false, error: e.message });
      });
  },
});

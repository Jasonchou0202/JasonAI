// 第 3 批入口：设置与更多（从第 1 批「我的」进来）。管理员看到账本和内容两组；成员只看到「我的」
const { whoAmI, demoState, hideOnCapture } = require("../../utils/b3");
Page({
  data: { admin: false, demo: null, error: "" },
  onShow() {
    hideOnCapture(true);
    this.load();
  },
  onHide() {
    hideOnCapture(false);
  },
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
  load() {
    return whoAmI()
      .then((me) => this.setData({ admin: me.admin, demo: demoState(), error: "" }))
      .catch((e) => this.setData({ error: e.message }));
  },
  go(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url });
  },
  exitDemo() {
    wx.navigateTo({ url: "/pkg-demo/index/index" });
  },
});

// 内容闭环看板 · 只读版（方案对照表 13a）：小程序不能打开 github.io，数据随 miniapp 函数打包；只给管理员
const { call, whoAmI } = require("../../utils/b3");
Page({
  data: { b: { kpis: [], stages: [], topics: [], decisions: [], risks: [], mechanisms: [] }, error: "" },
  onLoad() {
    whoAmI()
      .then((me) => (me.admin ? this.load() : wx.redirectTo({ url: "/pkg-settings/index/index" })))
      .catch((e) => this.setData({ error: e.message }));
  },
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
  load() {
    return call("miniapp.content.board")
      .then((b) => {
        const max = Math.max(1, ...b.stages.map((s) => s.count));
        b.stages = b.stages.map((s) => ({ ...s, pct: Math.round((s.count / max) * 100) }));
        this.setData({ b, error: "" });
      })
      .catch((e) => this.setData({ error: e.message }));
  },
  copy() {
    wx.setClipboardData({ data: this.data.b.webUrl || "" });
  },
});

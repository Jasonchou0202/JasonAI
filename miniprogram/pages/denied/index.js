Page({
  data: { text: "无权限" },
  onLoad(q) {
    this.setData({ text: q.status === "MINIAPP_OFF" ? "小程序暂未开放" : q.status === "disabled" ? "账号已被管理员停用" : "无权限" });
  },
});

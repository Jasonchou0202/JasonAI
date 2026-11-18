// 「微信服务通知」设置（方案对照表 10c / 15）：一次性订阅消息。模板 ID 从云端读（不是密钥），额度存在 miniapp_subs
const { call, whoAmI } = require("../../utils/b3");
const TEXT = {
  task: { title: "日程提醒", desc: "日程到点（或提前 15 分钟）发到微信" },
  apply: { title: "新申请提醒", desc: "有人在小程序里申请使用时提醒你" },
};
Page({
  data: { enabled: false, admin: false, kinds: [], busy: false, ok: "", error: "" },
  templates: {},
  onShow() {
    whoAmI()
      .then((me) => {
        this.setData({ admin: me.admin });
        return this.load();
      })
      .catch((e) => this.setData({ error: e.message }));
  },
  load() {
    return call("miniapp.subscribe.config").then((c) => this.show(c));
  },
  show(c) {
    this.templates = c.templates || {};
    const kinds = Object.keys(this.templates).map((k) => ({ key: k, ...TEXT[k], left: (c.quota && c.quota[k]) || 0 }));
    this.setData({ enabled: !!c.enabled, kinds });
  },
  subscribe() {
    const ids = Object.values(this.templates);
    if (!ids.length) return;
    this.setData({ busy: true, ok: "", error: "" });
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res) => {
        const results = {};
        ids.forEach((id) => (results[id] = res[id]));
        call("miniapp.subscribe.record", { results })
          .then((c) => {
            this.show(c);
            this.setData({ busy: false, ok: c.recorded ? "已记下，到点会发到微信" : "这次没有选「允许」，没有增加次数" });
          })
          .catch((e) => this.setData({ busy: false, error: e.message }));
      },
      fail: () => this.setData({ busy: false, error: "订阅弹窗没有打开，请稍后再试" }),
    });
  },
});

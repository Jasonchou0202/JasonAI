// 「微信服务通知」：一次性订阅「待办事项提醒」。模板 ID 从云端读（不是密钥），额度存在 miniapp_subs。
// 发送另由 MINIAPP_NOTIFY_ENABLED 控制；关着时仍可订阅记次数。
const { call, whoAmI } = require("../../utils/b3");
const TEXT = {
  task: { title: "待办事项提醒", desc: "只提醒你自己创建的日程" },
  apply: { title: "新申请提醒", desc: "有人在小程序里申请使用时提醒你" },
};
Page({
  data: { sending: false, admin: false, kinds: [], left: 0, busy: false, ok: "", error: "" },
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
    const left = kinds.reduce((n, k) => n + (k.left || 0), 0);
    this.setData({ sending: !!c.enabled, kinds, left });
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
            this.setData({ busy: false, ok: c.recorded ? "已记下。只提醒你自己创建的日程。" : "这次没有选「允许」，没有增加次数" });
          })
          .catch((e) => this.setData({ busy: false, error: e.message }));
      },
      fail: () => this.setData({ busy: false, error: "订阅弹窗没有打开，请稍后再试" }),
    });
  },
});

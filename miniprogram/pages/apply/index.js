const { call } = require("../../utils/api");
const { checkApply } = require("../../utils/validate");
const pad = (n) => (n < 10 ? "0" + n : "" + n);
function localTime(iso) {
  const d = new Date(iso);
  return d.getMonth() + 1 + "月" + d.getDate() + "日 " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
Page({
  data: { status: "none", name: "", phone: "", agree: false, error: "", busy: false, retryAt: "" },
  onLoad(q) {
    this.setData({ status: q.status || "none" });
  },
  onShow() {
    call("miniapp.me")
      .then((me) => {
        if (me.status === "owner" || me.status === "member") return wx.reLaunch({ url: "/pages/home/index" });
        if (me.status === "blocked") return wx.reLaunch({ url: "/pages/denied/index?status=blocked" });
        this.setData({ status: me.status, retryAt: me.retryAt ? localTime(me.retryAt) : "" });
      })
      .catch(() => {});
  },
  onName(e) {
    this.setData({ name: e.detail.value });
  },
  onPhone(e) {
    this.setData({ phone: e.detail.value });
  },
  onAgree(e) {
    this.setData({ agree: e.detail.value.length > 0 });
  },
  submit() {
    const { name, phone, agree } = this.data;
    const error = checkApply(name, phone, agree);
    if (error) return this.setData({ error });
    this.setData({ busy: true, error: "" });
    call("miniapp.apply", { name: name.trim(), phone: phone.trim(), agree: true })
      .then((r) => this.setData({ status: r.status, busy: false, phone: "" }))
      .catch((e) => this.setData({ error: e.message, busy: false }));
  },
  toRedeem() {
    wx.navigateTo({ url: "/pages/redeem/index" });
  },
});

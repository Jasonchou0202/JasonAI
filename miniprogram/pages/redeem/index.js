const { call } = require("../../utils/api");
const { normalizeCode } = require("../../utils/validate");
Page({
  data: { code: "", error: "", busy: false },
  onCode(e) {
    this.setData({ code: e.detail.value });
  },
  submit() {
    const code = normalizeCode(this.data.code);
    if (code.length !== 8) return this.setData({ error: "绑定码是 8 位" });
    this.setData({ busy: true, error: "" });
    call("miniapp.owner.redeem", { code })
      .then(() => wx.reLaunch({ url: "/pages/home/index" }))
      .catch((e) => this.setData({ error: e.message, busy: false }));
  },
});

// 报销记账：十天合账、已出账合计（管理员）、利润对照（Canvas）、本月报销明细、凭证查看、续费提醒
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
const { canvas, drawCompare } = require("../lib/canvas");
Page({
  data: { loading: true, error: "", month: "", v: null, admin: false, busy: false },
  onLoad(q) {
    this.setData({ month: (q && /^\d{4}-\d{2}$/.test(q.month || "") && q.month) || b2.today().slice(0, 7) });
  },
  onShow() {
    ui.privacyShow();
    this.load();
  },
  onHide: ui.privacyHide,
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
  load() {
    return ui
      .me()
      .then((me) =>
        ui.call("expenses.settlement", { month: this.data.month }).then((data) => {
          this.raw = data;
          this.setData({ loading: false, error: "", admin: me.admin, v: b2.expensesView(data, me.admin, this.data.month) }, () => this.draw());
        }),
      )
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  draw() {
    if (!this.data.v) return;
    canvas(this, "#compare").then((c) => drawCompare(c, this.data.v.compare));
  },
  prev() {
    this.setData({ month: b2.shiftMonth(this.data.month, -1), loading: true }, () => this.load());
  },
  next() {
    this.setData({ month: b2.shiftMonth(this.data.month, 1), loading: true }, () => this.load());
  },
  add() {
    wx.navigateTo({ url: "/pkg2/expenses/form" });
  },
  pending() {
    wx.navigateTo({ url: "/pkg2/expenses/pending" });
  },
  categories() {
    wx.navigateTo({ url: "/pkg2/expenses/categories" });
  },
  receipts(e) {
    const { id, n } = e.currentTarget.dataset;
    const open = (index) =>
      ui.run(this, () => ui.openAttachment("expenses.receipts.urls", id, index));
    if (Number(n) <= 1) return open(0);
    wx.showActionSheet({
      itemList: Array.from({ length: Number(n) }, (_, i) => `凭证 ${i + 1}`),
      success: (r) => open(r.tapIndex),
    });
  },
  renew(e) {
    const row = this.data.v.details.find((d) => d.id === e.currentTarget.dataset.id);
    if (!row) return;
    wx.showModal({
      title: "续费提醒",
      content: `${row.renewWhen} 提醒续费，日程名可改：`,
      editable: true,
      placeholderText: row.category,
      confirmText: "设提醒",
      confirmColor: "#B4532F",
      success: (r) => {
        if (!r.confirm) return;
        const name = b2.renewName(r.content || row.category, row.category);
        ui.run(this, () => ui.call("expenses.renew", { id: row.id, name }), "已设提醒").then((ok) => ok && this.load());
      },
    });
  },
});

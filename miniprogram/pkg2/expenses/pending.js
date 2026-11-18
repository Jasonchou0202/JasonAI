// 待确认（只给管理员）：成员提交的报销，确认入账或驳回
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { loading: true, error: "", busy: false, rows: [] },
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
      .then((me) => {
        if (!me.admin) {
          wx.navigateBack({ fail: () => wx.redirectTo({ url: "/pkg2/expenses/index" }) });
          return;
        }
        return ui.call("expenses.list", { status: "pending_confirm" }).then((d) =>
          this.setData({ loading: false, error: "", rows: d.items.map((r) => b2.pendingRow(r, d.people)) }),
        );
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  act(e) {
    const { id, kind } = e.currentTarget.dataset;
    const row = this.data.rows.find((r) => r.id === id);
    if (!row) return;
    const go = () =>
      ui.run(this, () => ui.call(kind === "confirm" ? "expenses.confirm" : "expenses.reject", { id, revision: row.revision, requestId: b2.requestId() }), kind === "confirm" ? "已确认入账" : "已驳回").then((ok) => ok && this.load());
    if (kind === "confirm") return go();
    ui.confirm("驳回这笔报销", `${row.category} ${row.amount}，驳回后不计入合账。`, "驳回").then((y) => y && go());
  },
  receipts(e) {
    ui.run(this, () => ui.openAttachment("expenses.receipts.urls", e.currentTarget.dataset.id, 0));
  },
});

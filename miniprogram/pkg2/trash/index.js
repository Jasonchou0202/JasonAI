// 回收站（只给管理员）：销售、日程、报销（报销开关开时）三类，恢复或彻底删除（彻底删除要二次确认，撤不回）
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
const KINDS = {
  sales: { label: "销售", restore: "sales.restore", purge: "sales.purge" },
  tasks: { label: "日程", restore: "tasks.restore", purge: "tasks.purge" },
  expenses: { label: "报销", restore: "expenses.restore", purge: "expenses.purge" },
};
Page({
  data: { loading: true, error: "", busy: false, kind: "sales", tabs: [], rows: [], total: 0, page: 1 },
  onShow() {
    ui.privacyShow();
    ui.me()
      .then((me) => {
        if (!me.admin) {
          this.setData({ loading: false, error: "回收站只有管理员可以查看" });
          return;
        }
        const tabs = ["sales", "tasks", ...(me.expenses ? ["expenses"] : [])].map((k) => ({ id: k, label: KINDS[k].label }));
        this.setData({ tabs }, () => this.load());
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  onHide: ui.privacyHide,
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
  load() {
    const k = this.data.kind;
    const p =
      k === "sales"
        ? ui.call("sales.list", { deleted: true, page: this.data.page }).then((r) => ({ rows: r.items.map(b2.trashSale), total: r.total }))
        : k === "tasks"
          ? Promise.all([ui.call("tasks.list", { deleted: true }), ui.call("customers.list", {})]).then(([rows, cs]) => {
              const names = {};
              cs.forEach((c) => (names[c.id] = b2.displayCustomerName(c.name)));
              return { rows: rows.map((t) => b2.trashTask(t, (id) => names[id] || "客户")), total: rows.length };
            })
          : ui.call("expenses.list", { deleted: true }).then((r) => ({ rows: r.items.map(b2.trashExpense), total: r.total }));
    return p.then((r) => this.setData({ loading: false, error: "", rows: r.rows, total: r.total })).catch((e) => this.setData({ loading: false, error: e.message }));
  },
  pick(e) {
    this.setData({ kind: e.currentTarget.dataset.k, page: 1, rows: [], loading: true }, () => this.load());
  },
  turn(e) {
    this.setData({ page: Math.max(1, this.data.page + Number(e.currentTarget.dataset.d)), loading: true }, () => this.load());
  },
  restore(e) {
    const row = this.data.rows.find((r) => r.id === e.currentTarget.dataset.id);
    if (!row) return;
    const k = KINDS[this.data.kind];
    ui.run(this, () => ui.call(k.restore, { id: row.id, revision: row.revision, requestId: b2.requestId() }), "已恢复").then((ok) => ok && this.load());
  },
  purge(e) {
    const row = this.data.rows.find((r) => r.id === e.currentTarget.dataset.id);
    if (!row) return;
    const k = KINDS[this.data.kind];
    ui.confirm("彻底删除", `「${row.title}」彻底删除后找不回来，确定吗？`, "彻底删除").then(
      (y) => y && ui.run(this, () => ui.call(k.purge, { id: row.id, revision: row.revision, requestId: b2.requestId() }), "已彻底删除").then((ok) => ok && this.load()),
    );
  },
});

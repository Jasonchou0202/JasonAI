// 报销分类设置（只给管理员）：新增、删除（删除只是不在新记录里显示，已有报销保留）
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { loading: true, error: "", busy: false, rows: [], name: "" },
  onShow() {
    ui.privacyShow();
    this.load();
  },
  onHide: ui.privacyHide,
  load() {
    return ui
      .call("expenses.meta")
      .then((m) => this.setData({ loading: false, error: "", rows: b2.selectableCategories(m.categories).map((c) => ({ id: c.id, name: c.name, hint: c.hint || "", preset: !!c.preset })) }))
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  onName(e) {
    this.setData({ name: e.detail.value });
  },
  add() {
    const name = this.data.name.trim();
    if (!name) return;
    ui.run(this, () => ui.call("expenses.categories.create", { name, requestId: b2.requestId() }), "已添加").then((ok) => ok && (this.setData({ name: "" }), this.load()));
  },
  archive(e) {
    const { id, name } = e.currentTarget.dataset;
    ui.confirm("删除分类", `不再在新记录里显示「${name}」？已有报销会保留这个分类。`, "删除").then(
      (y) => y && ui.run(this, () => ui.call("expenses.categories.archive", { id }), "已删除").then((ok) => ok && this.load()),
    );
  },
});

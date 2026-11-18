// 名称合并 / 拆分（只给管理员）：把别的名称并进这个客户、拆开已并入的名称、处理系统建议的同名合并。
// 合并只改客户档案的指向，不改任何销售记录；拆开能恢复原来的客户。
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { loading: true, error: "", busy: false, id: "", name: "", merged: [], query: "", candidates: [], groups: [] },
  onLoad(q) {
    this.setData({ id: (q && q.id) || "" });
  },
  onShow() {
    ui.privacyShow();
    this.load();
  },
  onHide: ui.privacyHide,
  load() {
    return Promise.all([ui.call("customers.list", {}), ui.call("customers.suggestions", {}).catch(() => [])])
      .then(([list, groups]) => {
        this.list = list;
        // 打开的是已并入别人的名称时，转到它最终并入的那位客户
        let self = list.find((c) => c.id === this.data.id);
        for (let i = 0; self && self.mergedInto && i < 10; i++) self = list.find((c) => c.id === self.mergedInto) || self;
        if (self && self.id !== this.data.id) this.setData({ id: self.id });
        this.groups = groups || [];
        this.setData({
          loading: false,
          error: "",
          name: self ? b2.displayCustomerName(self.name) : "",
          merged: list.filter((c) => c.mergedInto === this.data.id).map((c) => ({ id: c.id, name: b2.displayCustomerName(c.name), revision: c.revision })),
          candidates: b2.mergeCandidates(list, this.data.id, this.data.query),
          groups: this.groups.slice(0, 20).map((g) => ({
            id: g.id,
            target: b2.displayCustomerName((g.members.find((m) => m.customer.id === g.targetId) || g.members[0]).customer.name),
            names: g.members.map((m) => b2.displayCustomerName(m.customer.name)).join("、"),
            sub: `${g.members.length} 个名称 · ${g.totals.count} 笔 · ${b2.yuan(g.totals.revenue)}`,
          })),
        });
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  onQuery(e) {
    this.setData({ query: e.detail.value, candidates: b2.mergeCandidates(this.list || [], this.data.id, e.detail.value) });
  },
  absorb(e) {
    const src = (this.list || []).find((c) => c.id === e.currentTarget.dataset.id);
    if (!src) return;
    ui.confirm("合并客户", `把「${b2.displayCustomerName(src.name)}」并入「${this.data.name}」？销售记录不会改，之后可以拆开。`, "合并").then(
      (y) => y && ui.run(this, () => ui.call("customers.merge", { sourceId: src.id, targetId: this.data.id, revision: src.revision, requestId: b2.requestId() }), "已合并").then((ok) => ok && this.load()),
    );
  },
  split(e) {
    const row = this.data.merged.find((m) => m.id === e.currentTarget.dataset.id);
    if (!row) return;
    ui.confirm("拆开名称", `把「${row.name}」从「${this.data.name}」拆出来，恢复成单独的客户？`, "拆开").then(
      (y) => y && ui.run(this, () => ui.call("customers.unmerge", { id: row.id, revision: row.revision, requestId: b2.requestId() }), "已拆开").then((ok) => ok && this.load()),
    );
  },
  mergeGroup(e) {
    const g = this.groups.find((x) => x.id === e.currentTarget.dataset.id);
    if (!g) return;
    const sources = g.members.filter((m) => m.customer.id !== g.targetId).map((m) => ({ id: m.customer.id, revision: m.customer.revision }));
    ui.run(this, () => ui.call("customers.mergeMany", { targetId: g.targetId, sources, requestId: b2.requestId() }), "已合并").then((ok) => ok && this.load());
  },
});

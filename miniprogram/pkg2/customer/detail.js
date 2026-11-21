// 客户详情：成交记录（本月 / 近 3 个月 / 全部，按月分组、分页）、合计、买过的商品、客户画像（职业/需求/付款方式，可编辑）、
// 开票信息入口（开票开关开时）、名称合并/拆分入口（只给管理员）。打开方式：/pkg2/customer/detail?id=客户编号[&month=yyyy-MM|all]
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
function accountRows(list) {
  return (list && list.length ? list : [b2.emptyClaudeAccount()]).map((a, i) => ({
    type: a.type || "",
    usage: a.usage || "",
    computer: a.computer || "",
    email: a.email || "",
    hubStudioPhone: a.hubStudioPhone || "",
    no: b2.claudeAccountNo(i),
    web: a.usage === "网页端",
  }));
}
Page({
  data: { loading: true, error: "", busy: false, id: "", name: "", aliases: [], view: "", month: "", hint: "", v: null, limit: 20, admin: false, invoices: false, profile: null, editing: false, form: null, options: null, monthText: "", accountSummaries: [], showClaude: false, types: b2.CLAUDE_TYPES, usages: b2.CLAUDE_USAGES, computers: b2.CLAUDE_COMPUTERS },
  onLoad(q) {
    const thisMonth = b2.today().slice(0, 7);
    const m = q && q.month;
    this.thisMonth = thisMonth;
    this.setData({ id: (q && q.id) || "", month: m && m !== "all" ? m : thisMonth, view: m === "all" ? "all" : m ? "month" : "", monthText: b2.monthLabel(m && m !== "all" ? m : thisMonth) });
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
    return Promise.all([ui.me(), ui.call("customers.detail", { id: this.data.id, month: "all" }), ui.call("customers.list", {})])
      .then(([me, d, list]) => {
        this.detail = d;
        this.customers = list;
        let view = this.data.view;
        let hint = "";
        if (!view) {
          view = b2.defaultSalesView(d.sales, this.thisMonth);
          hint = b2.salesViewHint(view);
        }
        const p = d.customer.profile || {};
        const cv = b2.profileClaudeView(p);
        this.setData({
          loading: false, error: "", admin: me.admin, invoices: me.invoices, view, hint,
          name: b2.displayCustomerName(d.customer.name),
          aliases: d.aliases.filter((a) => a !== d.customer.name).map(b2.displayCustomerName),
          aliasText: d.aliases.filter((a) => a !== d.customer.name).map(b2.displayCustomerName).join("、"),
          needsText: cv.needsText,
          accountSummaries: cv.accountSummaries,
          showClaude: cv.showClaude,
          profile: { occupation: p.occupation || "", needs: p.needs || [], needNote: p.needNote || "", payment: p.payment || "", claudeAccounts: p.claudeAccounts || [] },
          options: b2.profileOptions(list.map((c) => c.profile).filter(Boolean)),
        });
        this.render();
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  render() {
    if (!this.detail) return;
    const d = this.data;
    this.setData({ v: b2.customerDetailView(this.detail.sales, d.view, d.month, this.thisMonth, d.limit) });
  },
  pickView(e) {
    this.setData({ view: e.currentTarget.dataset.v, hint: "", limit: 20 }, () => this.render());
  },
  prev() {
    const month = b2.shiftMonth(this.data.month, -1);
    this.setData({ month, monthText: b2.monthLabel(month), view: "month", hint: "", limit: 20 }, () => this.render());
  },
  next() {
    const month = b2.shiftMonth(this.data.month, 1);
    this.setData({ month, monthText: b2.monthLabel(month), view: "month", hint: "", limit: 20 }, () => this.render());
  },
  more() {
    this.setData({ limit: this.data.limit + 20 }, () => this.render());
  },
  edit() {
    const p = this.data.profile;
    const needs = this.data.options.needs.map((n) => ({ n, on: p.needs.indexOf(n) >= 0 }));
    p.needs.forEach((n) => needs.some((x) => x.n === n) || needs.push({ n, on: true }));
    this.setData({ editing: true, form: { occupation: p.occupation, needNote: p.needNote, payment: p.payment, needs, newNeed: "", showClaude: p.needs.indexOf(b2.CLAUDE_NEED) >= 0, accounts: accountRows(p.claudeAccounts) } });
  },
  cancel() {
    this.setData({ editing: false });
  },
  formPatch(patch) {
    this.setData({ form: Object.assign({}, this.data.form, patch) });
  },
  fset(e) {
    this.formPatch({ [e.currentTarget.dataset.k]: e.detail.value });
  },
  pickOcc(e) {
    const v = e.currentTarget.dataset.v;
    this.formPatch({ occupation: v === this.data.form.occupation ? "" : v });
  },
  pickPay(e) {
    const v = e.currentTarget.dataset.v;
    this.formPatch({ payment: v === this.data.form.payment ? "" : v });
  },
  toggleNeed(e) {
    const i = Number(e.currentTarget.dataset.i);
    const needs = this.data.form.needs.map((x, j) => (j === i ? { n: x.n, on: !x.on } : x));
    const showClaude = needs.some((x) => x.n === b2.CLAUDE_NEED && x.on);
    const accounts = this.data.form.accounts && this.data.form.accounts.length ? this.data.form.accounts : accountRows([]);
    this.formPatch({ needs, showClaude, accounts });
  },
  addNeed() {
    const n = (this.data.form.newNeed || "").trim();
    if (!n || n.length > 40) return;
    this.formPatch({ needs: [...this.data.form.needs.filter((x) => x.n !== n), { n, on: true }], newNeed: "" });
  },
  acctSet(e) {
    const i = Number(e.currentTarget.dataset.i);
    const k = e.currentTarget.dataset.k;
    const accounts = this.data.form.accounts.map((a, j) => (j === i ? Object.assign({}, a, { [k]: e.detail.value }) : a));
    this.formPatch({ accounts });
  },
  pickAcct(e) {
    const i = Number(e.currentTarget.dataset.i);
    const k = e.currentTarget.dataset.k;
    const v = e.currentTarget.dataset.v;
    const accounts = this.data.form.accounts.map((a, j) => {
      if (j !== i) return a;
      const next = Object.assign({}, a, { [k]: v });
      if (k === "usage") next.web = v === "网页端";
      return next;
    });
    this.formPatch({ accounts });
  },
  addAcct() {
    this.formPatch({ accounts: accountRows([...(this.data.form.accounts || []), b2.emptyClaudeAccount()]) });
  },
  delAcct(e) {
    const list = this.data.form.accounts;
    if (list.length <= 1) return;
    this.formPatch({ accounts: accountRows(list.filter((_, j) => j !== Number(e.currentTarget.dataset.i))) });
  },
  saveProfile() {
    const f = this.data.form;
    const c = this.detail.customer;
    const needs = f.needs.filter((x) => x.on).map((x) => x.n);
    const profile = {
      ...(f.occupation.trim() ? { occupation: f.occupation.trim() } : {}),
      needs,
      ...(f.needNote.trim() ? { needNote: f.needNote } : {}),
      ...(f.payment ? { payment: f.payment } : {}),
    };
    if (needs.indexOf(b2.CLAUDE_NEED) >= 0) {
      profile.claudeAccounts = (f.accounts || []).filter((a) => !b2.blankClaudeAccount(a));
    }
    ui.run(this, () => ui.call("customers.profile.save", { id: c.id, revision: c.revision, profile, requestId: b2.requestId() }), "已保存").then((ok) => ok && (this.setData({ editing: false }), this.load()));
  },
  invoiceProfile() {
    wx.navigateTo({ url: `/pkg2/invoices/profile?customerId=${this.detail.customer.id}&name=${encodeURIComponent(this.data.name)}` });
  },
  merge() {
    wx.navigateTo({ url: `/pkg2/customer/merge?id=${this.detail.customer.id}` });
  },
});

// 客户详情：成交记录（本月 / 近 3 个月 / 全部，按月分组、分页）、合计、买过的商品、客户画像（职业/需求/付款方式，可编辑）、
// 开票信息入口（开票开关开时）、名称合并/拆分入口（只给管理员）。打开方式：/pkg2/customer/detail?id=客户编号[&month=yyyy-MM|all]
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { loading: true, error: "", busy: false, id: "", name: "", aliases: [], view: "", month: "", hint: "", v: null, limit: 20, admin: false, invoices: false, profile: null, editing: false, form: null, options: null, monthText: "" },
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
        this.setData({
          loading: false, error: "", admin: me.admin, invoices: me.invoices, view, hint,
          name: b2.displayCustomerName(d.customer.name),
          aliases: d.aliases.filter((a) => a !== d.customer.name).map(b2.displayCustomerName),
          aliasText: d.aliases.filter((a) => a !== d.customer.name).map(b2.displayCustomerName).join("、"),
          needsText: (p.needs || []).join("、"),
          profile: { occupation: p.occupation || "", needs: p.needs || [], needNote: p.needNote || "", payment: p.payment || "" },
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
    this.setData({ editing: true, form: { occupation: p.occupation, needNote: p.needNote, payment: p.payment, needs, newNeed: "" } });
  },
  cancel() {
    this.setData({ editing: false });
  },
  fset(e) {
    this.setData({ [`form.${e.currentTarget.dataset.k}`]: e.detail.value });
  },
  pickOcc(e) {
    this.setData({ "form.occupation": e.currentTarget.dataset.v === this.data.form.occupation ? "" : e.currentTarget.dataset.v });
  },
  pickPay(e) {
    this.setData({ "form.payment": e.currentTarget.dataset.v === this.data.form.payment ? "" : e.currentTarget.dataset.v });
  },
  toggleNeed(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ [`form.needs[${i}].on`]: !this.data.form.needs[i].on });
  },
  addNeed() {
    const n = (this.data.form.newNeed || "").trim();
    if (!n || n.length > 40) return;
    this.setData({ "form.needs": [...this.data.form.needs.filter((x) => x.n !== n), { n, on: true }], "form.newNeed": "" });
  },
  saveProfile() {
    const f = this.data.form;
    const c = this.detail.customer;
    const profile = {
      ...(f.occupation.trim() ? { occupation: f.occupation.trim() } : {}),
      needs: f.needs.filter((x) => x.on).map((x) => x.n),
      ...(f.needNote.trim() ? { needNote: f.needNote } : {}),
      ...(f.payment ? { payment: f.payment } : {}),
    };
    ui.run(this, () => ui.call("customers.profile.save", { id: c.id, revision: c.revision, profile, requestId: b2.requestId() }), "已保存").then((ok) => ok && (this.setData({ editing: false }), this.load()));
  },
  invoiceProfile() {
    wx.navigateTo({ url: `/pkg2/invoices/profile?customerId=${this.detail.customer.id}&name=${encodeURIComponent(this.data.name)}` });
  },
  merge() {
    wx.navigateTo({ url: `/pkg2/customer/merge?id=${this.detail.customer.id}` });
  },
});

// 开票：三个顶部数字、按状态/客户/月份筛选、四种状态配色、资料齐/缺资料、快速改状态
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { loading: true, error: "", busy: false, month: "", all: false, status: "", customerIndex: 0, customers: [], filters: b2.INVOICE_STATUS_FILTERS, stats: [], rows: [], colors: b2.INVOICE_COLORS, monthText: "" },
  onLoad() {
    const month = b2.today().slice(0, 7);
    this.setData({ month, monthText: b2.monthLabel(month) });
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
    const d = this.data;
    const c = d.customers[d.customerIndex];
    const p = { month: d.all ? "all" : d.month, ...(d.status ? { status: d.status } : {}), ...(c && c.id ? { customerId: c.id } : {}) };
    return ui
      .call("invoices.list", p)
      .then((r) => {
        const customers = [{ id: "", name: "全部客户" }, ...r.customers.map((x) => ({ id: x.id, name: b2.displayCustomerName(x.name) }))];
        const keep = c && c.id ? customers.findIndex((x) => x.id === c.id) : 0;
        this.setData({ loading: false, error: "", stats: b2.invoiceStatsView(r.stats), rows: r.items.map(b2.invoiceRow), customers, customerIndex: Math.max(0, keep) });
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  pickStatus(e) {
    this.setData({ status: e.currentTarget.dataset.id }, () => this.load());
  },
  pickCustomer(e) {
    this.setData({ customerIndex: Number(e.detail.value) }, () => this.load());
  },
  prev() {
    const month = b2.shiftMonth(this.data.month, -1);
    this.setData({ month, monthText: b2.monthLabel(month), all: false }, () => this.load());
  },
  next() {
    const month = b2.shiftMonth(this.data.month, 1);
    this.setData({ month, monthText: b2.monthLabel(month), all: false }, () => this.load());
  },
  toggleAll() {
    this.setData({ all: !this.data.all }, () => this.load());
  },
  edit(e) {
    wx.navigateTo({ url: `/pkg2/invoices/edit?saleId=${e.currentTarget.dataset.sale}` });
  },
  profile(e) {
    const id = e.currentTarget.dataset.customer;
    if (id) wx.navigateTo({ url: `/pkg2/invoices/profile?customerId=${id}` });
  },
});

// 财务标签页：报销记账、开票、经营图表入口（权限与「更多」里原来的账务组一致，不放宽不收紧）
const D = require("../../lib/domain");
const { call } = require("../../utils/api");
const session = require("../../utils/session");

Page({
  data: {
    loading: true,
    error: "",
    expenses: false,
    invoices: false,
    expenseMetrics: [],
    invoiceMetrics: [],
  },
  onShow() {
    session.protect(true);
    this.load();
  },
  onHide() {
    session.protect(false);
  },
  onUnload() {
    session.protect(false);
  },
  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },
  load(force) {
    return session
      .load(force)
      .then((me) => {
        const expenses = !!me.expensesEnabled;
        const invoices = !!me.invoiceEnabled;
        const admin = me.role === "admin" || !!me.owner;
        const month = D.today().slice(0, 7);
        const tasks = [];
        if (expenses) tasks.push(call("expenses.settlement", { month }).catch(() => null));
        else tasks.push(Promise.resolve(null));
        if (invoices) tasks.push(call("invoices.list", { month }).catch(() => null));
        else tasks.push(Promise.resolve(null));
        return Promise.all(tasks).then((pair) => {
          const settlement = pair[0];
          const invoiceList = pair[1];
          this.setData({
            loading: false,
            error: "",
            expenses: expenses,
            invoices: invoices,
            expenseMetrics: expenseMetrics(settlement, admin, month),
            invoiceMetrics: invoiceMetrics(invoiceList, month),
          });
        });
      })
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ loading: false, error: e.message });
      });
  },
  openExpenses() {
    wx.navigateTo({ url: "/pkg2/expenses/index" });
  },
  openInvoices() {
    wx.navigateTo({ url: "/pkg2/invoices/index" });
  },
  openCharts() {
    wx.navigateTo({ url: "/pkg2/charts/index" });
  },
});

function expenseMetrics(data, admin, month) {
  if (!data || !data.details) return [];
  const booked = data.details.filter((d) => d.status === "pending_reimburse" || d.status === "reimbursed");
  const pending = data.details.filter((d) => d.status === "pending_confirm");
  const sum = booked.reduce((n, r) => n + (r.amount || 0), 0);
  const out = [
    { k: Number(month.slice(5, 7)) + " 月已入账", v: booked.length + " 笔 · " + D.yuan(sum) },
  ];
  if (admin && pending.length) out.push({ k: "待你确认", v: pending.length + " 笔" });
  return out;
}

function invoiceMetrics(data, month) {
  if (!data || !data.stats) return [];
  const s = data.stats;
  const issuedMonth = Number((s.month || month).slice(5, 7));
  return [
    { k: "待开票", v: (s.pending && s.pending.count ? s.pending.count : 0) + " 笔" },
    { k: issuedMonth + " 月已开", v: (s.issued && s.issued.count ? s.issued.count : 0) + " 笔" },
  ];
}

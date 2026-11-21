// 首页看板：本月汇总、利润走势（每日/每周/每月目标图）、本月商品贡献、客户排行前 5、铃铛角标
// 数字全部由云端 dashboard / customers.ranking 算好，图表坐标复用 lib/domain（与网页同一套计算）
const D = require("../../lib/domain");
const { call } = require("../../utils/api");
const session = require("../../utils/session");
const { canvas } = require("../../utils/chart");

Page({
  data: {
    loading: true,
    error: "",
    view: null,
    period: "month",
    selected: "",
    summary: null,
    canPrev: false,
    canNext: false,
    bell: "",
    isAdmin: false,
    productHeight: 60,
    profitSize: 128,
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
    const day = D.today();
    return session
      .load(force)
      .then((me) =>
        Promise.all([
          call("dashboard"),
          call("customers.ranking", { period: "all" }).catch(() => null),
          call("tasks.list", { from: day, to: day }).catch(() => []),
        ]).then(([dash, ranking, tasks]) => {
          this.dash = dash;
          this.start = undefined;
          const b = D.bell(tasks, day);
          const view = D.homeView(dash, ranking, day);
          this.setData({
            loading: false,
            error: "",
            isAdmin: me.role === "admin",
            view,
            profitSize: profitFontSize(view.monthProfit),
            bell: b.badge,
            selected: "",
          }, () => this.drawAll());
        }),
      )
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ loading: false, error: e.message });
      });
  },
  buckets() {
    const d = this.dash;
    return this.data.period === "day" ? d.days : this.data.period === "week" ? d.weeks : d.months;
  },
  drawAll() {
    this.drawTrend();
    this.drawProducts();
  },
  drawTrend() {
    if (!this.dash) return;
    canvas(this, "#trend").then((c) => {
      if (!c) return;
      const d = this.dash;
      const layout =
        this.data.period === "month"
          ? D.profitTargetLayout({
              months: d.months,
              current: D.today().slice(0, 7),
              startProfit: d.profitTargetStart,
              width: c.width,
              height: c.height,
              start: this.start,
              selected: this.data.selected,
            })
          : D.bucketBarsLayout({ buckets: this.buckets(), width: c.width, height: c.height, selected: this.data.selected });
      this.layout = layout;
      if (!layout) return c.ctx.clearRect(0, 0, c.width, c.height);
      this.start = layout.start;
      D.drawChart(c.ctx, layout);
      const shown = this.data.period === "month" ? this.buckets().filter((b) => layout.bars.some((x) => x.key === b.key.slice(0, 7))) : this.buckets();
      this.setData({
        canPrev: layout.canPrev,
        canNext: layout.canNext,
        summary: D.trendSummary(shown, this.data.selected),
        note: layout.note,
      });
    });
  },
  drawProducts() {
    const products = (this.dash && this.dash.products) || [];
    if (!products.length) return;
    canvas(this, "#products").then((c) => {
      if (!c) return;
      const layout = D.productBarsLayout(products, c.width);
      if (Math.abs(layout.height - this.data.productHeight) > 1) {
        return this.setData({ productHeight: layout.height }, () => this.drawProducts());
      }
      D.drawProductBars(c.ctx, layout, D.money);
    });
  },
  setPeriod(e) {
    const period = e.currentTarget.dataset.p;
    if (period === this.data.period) return;
    this.start = undefined;
    this.setData({ period, selected: "" }, () => this.drawTrend());
  },
  shift(e) {
    if (!this.layout) return;
    this.start = this.layout.start + Number(e.currentTarget.dataset.n);
    this.drawTrend();
  },
  tapTrend(e) {
    const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]) || e.detail || {};
    if (!this.layout || typeof t.x !== "number") return;
    const bar = D.hitBar(this.layout, t.x);
    if (!bar) return;
    this.setData({ selected: bar.key === this.data.selected ? "" : bar.key });
    this.drawTrend();
  },
  openRange() {
    const s = this.data.summary;
    if (!s || !s.from) return;
    getApp().globalData.detailFilters = { from: s.from, to: s.to };
    wx.switchTab({ url: "/pages/details/index" });
  },
  openMonth() {
    getApp().globalData.detailFilters = { preset: "month" };
    wx.switchTab({ url: "/pages/details/index" });
  },
  openBell() {
    wx.navigateTo({ url: "/pages/bell/index" });
  },
  newSale() {
    wx.navigateTo({ url: "/pages/sale/index" });
  },
});

/** 首屏利润数字：默认尽量大，位数多时缩小，避免 iPhone 宽度溢出 */
function profitFontSize(text) {
  const n = String(text || "").length;
  if (n >= 14) return 72;
  if (n >= 12) return 84;
  if (n >= 10) return 100;
  if (n >= 8) return 116;
  return 128;
}

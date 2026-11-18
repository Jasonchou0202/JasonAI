// 经营图表：近十天利润（报销开关开时，放最上面）、每月新增客户走势、每月四色块、客户 × 产品矩阵。
// 统计在云端 miniapp.insights / expenses.shares 里算（权限和网页一样），这里只画图；计算全部复用 src/domain。
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
const { canvas, drawLine } = require("../lib/canvas");
const RANGES = [{ id: "month", label: "本月" }, { id: "quarter", label: "本季度" }, { id: "year", label: "本年" }];
Page({
  data: { loading: true, error: "", rule: b2.NEW_RULE_TEXT, legend: [], line: null, shown: 0, quad: null, end: 0, ranges: RANGES, range: "month", matrix: [], shares: [], sharesDesc: b2.DECADE_SHARES_DESC },
  onLoad() {
    this.setData({ legend: b2.QUADRANTS.map((q) => ({ q, label: b2.QUADRANT_INFO[q].label, color: b2.QUADRANT_INFO[q].color })) });
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
      .then((me) => Promise.all([ui.call("miniapp.insights"), me.expenses ? ui.call("expenses.shares", {}).catch(() => null) : null]))
      .then(([d, s]) => {
        this.ins = d;
        const rows = d.newCustomers;
        const end = Math.max(d.quadMonths.length - 1, 0);
        this.setData(
          {
            loading: false, error: "",
            shown: Math.max(rows.length - 1, 0),
            readout: rows.length ? { month: rows[rows.length - 1].month.replace("-", " 年 ") + " 月", count: rows[rows.length - 1].count } : null,
            hasLine: rows.length > 0,
            end, quad: b2.quadMonthsView(d.quadMonths, end),
            matrix: b2.matrixView(d.matrix[this.data.range]),
            shares: s && s.items ? b2.decadeSharesView(s.items) : [],
          },
          () => this.draw(),
        );
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  draw() {
    if (!this.ins || !this.ins.newCustomers.length) return;
    canvas(this, "#line").then((c) => c && drawLine(c, b2.lineChart(this.ins.newCustomers, c.width, c.height), this.data.shown));
  },
  tapLine(e) {
    const rows = this.ins && this.ins.newCustomers;
    if (!rows || !rows.length) return;
    wx.createSelectorQuery().in(this).select("#line").boundingClientRect((r) => {
      if (!r) return;
      const pts = b2.lineChart(rows, r.width, r.height).points;
      const x = e.detail.x - r.left;
      let best = 0;
      pts.forEach((p, i) => Math.abs(p.x - x) < Math.abs(pts[best].x - x) && (best = i));
      this.setData({ shown: best, readout: { month: rows[best].month.replace("-", " 年 ") + " 月", count: rows[best].count } }, () => this.draw());
    }).exec();
  },
  slide(e) {
    const end = Number(e.detail.value);
    this.setData({ end, quad: b2.quadMonthsView(this.ins.quadMonths, end) });
  },
  pickRange(e) {
    const range = e.currentTarget.dataset.id;
    this.setData({ range, matrix: b2.matrixView(this.ins.matrix[range]) });
  },
  openExpenses() {
    wx.navigateTo({ url: "/pkg2/expenses/index" });
  },
});

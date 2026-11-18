// 销售明细：时间段、商品、搜索筛选，分页；成员只能改、删自己录入的（云端同样把关）
// 删除后可在「已删除」里恢复；回收站的彻底删除只给管理员（第 2 批）
const D = require("../../lib/domain");
const { call } = require("../../utils/api");
const session = require("../../utils/session");

const PRESETS = [
  { key: "all", label: "全部" },
  { key: "today", label: "今天" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "lastMonth", label: "上月" },
];

Page({
  data: {
    presets: PRESETS,
    preset: "month",
    from: "",
    to: "",
    search: "",
    productIndex: 0,
    productNames: ["全部商品"],
    deleted: false,
    page: 1,
    rows: [],
    totals: null,
    info: null,
    loading: true,
    error: "",
    showFilters: false,
  },
  onLoad() {
    this.applyPreset("month", false);
  },
  onShow() {
    session.protect(true);
    const incoming = getApp().globalData.detailFilters;
    if (incoming) {
      getApp().globalData.detailFilters = null;
      if (incoming.preset) this.applyPreset(incoming.preset, false);
      else this.setData({ preset: "", from: incoming.from || "", to: incoming.to || "", page: 1, deleted: false });
    }
    this.load();
  },
  onHide() {
    session.protect(false);
  },
  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },
  applyPreset(key, reload) {
    const r = D.presetRange(key, D.today());
    this.setData({ preset: key, from: r.from || "", to: r.to || "", page: 1 });
    if (reload !== false) this.load();
  },
  filters() {
    const d = this.data;
    const product = this.products && d.productIndex > 0 ? this.products[d.productIndex - 1] : null;
    return D.cleanFilters({ from: d.from, to: d.to, search: d.search, productId: product ? product.id : "", deleted: d.deleted, page: d.page });
  },
  load(force) {
    this.setData({ loading: true, error: "" });
    return session
      .load(force)
      .then((me) => {
        this.me = me;
        return Promise.all([this.products ? Promise.resolve(this.products) : call("products.list"), call("sales.list", this.filters())]);
      })
      .then(([products, page]) => {
        this.products = (products || []).filter((p) => !p.archivedAt);
        const me = { role: this.me.role, uid: this.me.uid };
        this.setData({
          loading: false,
          productNames: ["全部商品"].concat(this.products.map((p) => p.name)),
          rows: page.items.map((s) => D.saleRow(s, me)),
          totals: D.totalsText(page.totals),
          info: D.pageInfo(page.total, this.data.page),
        });
        this.items = page.items;
      })
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ loading: false, error: e.message });
      });
  },
  tapPreset(e) {
    this.applyPreset(e.currentTarget.dataset.key);
  },
  toggleFilters() {
    this.setData({ showFilters: !this.data.showFilters });
  },
  pickFrom(e) {
    this.setData({ from: e.detail.value, preset: "", page: 1 });
    this.load();
  },
  pickTo(e) {
    this.setData({ to: e.detail.value, preset: "", page: 1 });
    this.load();
  },
  pickProduct(e) {
    this.setData({ productIndex: Number(e.detail.value), page: 1 });
    this.load();
  },
  typeSearch(e) {
    this.setData({ search: e.detail.value });
  },
  doSearch() {
    this.setData({ page: 1 });
    this.load();
  },
  toggleDeleted() {
    this.setData({ deleted: !this.data.deleted, page: 1 });
    this.load();
  },
  clearFilters() {
    this.setData({ search: "", productIndex: 0, deleted: false });
    this.applyPreset("all");
  },
  prev() {
    if (this.data.page <= 1) return;
    this.setData({ page: this.data.page - 1 });
    this.load();
  },
  next() {
    if (!this.data.info || !this.data.info.hasNext) return;
    this.setData({ page: this.data.page + 1 });
    this.load();
  },
  openRow(e) {
    const row = this.data.rows[Number(e.currentTarget.dataset.i)];
    if (!row) return;
    const items = row.deleted ? ["恢复这笔"] : row.editable ? ["编辑", "删除", "给这位客户建日程"] : ["给这位客户建日程"];
    wx.showActionSheet({
      itemList: items,
      success: (r) => {
        const pick = items[r.tapIndex];
        if (pick === "编辑") wx.navigateTo({ url: "/pages/sale/index?id=" + row.id });
        else if (pick === "删除") this.remove(row, false);
        else if (pick === "恢复这笔") this.remove(row, true);
        else if (pick === "给这位客户建日程") {
          const sale = this.items.find((s) => s.id === row.id);
          wx.navigateTo({ url: "/pages/task/index?customer=" + encodeURIComponent((sale && sale.customer) || "") });
        }
      },
    });
  },
  remove(row, restore) {
    const go = () =>
      call(restore ? "sales.restore" : "sales.delete", { id: row.id, revision: row.revision, requestId: D.requestId() })
        .then(() => {
          wx.showToast({ title: restore ? "已恢复" : "已删除", icon: "success" });
          this.load();
        })
        .catch((e) => this.setData({ error: e.message }));
    if (restore) return go();
    wx.showModal({
      title: "删除这笔销售",
      content: row.product + " · " + row.customer + " · " + row.revenue + "。删除后可在「已删除」里恢复。",
      confirmText: "删除",
      confirmColor: "#9E2A1E",
      success: (r) => r.confirm && go(),
    });
  },
  newSale() {
    wx.navigateTo({ url: "/pages/sale/index" });
  },
});

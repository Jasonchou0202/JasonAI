// 导出 CSV（只给管理员，和网页一样）：按日期范围和搜索词，云端分块生成，写进本机临时文件，再「发送到聊天」
// （发给自己或文件传输助手），电脑上用 Excel 打开。表头、格式和网页 downloadCsv 完全一致。
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { error: "", busy: false, from: "", to: "", search: "", file: null, progress: 0, today: "", admin: true },
  onLoad() {
    const today = b2.today();
    this.setData({ today, from: today.slice(0, 7) + "-01", to: today });
  },
  onShow() {
    ui.privacyShow();
    ui.me().then((me) => this.setData({ admin: me.admin, error: me.admin ? "" : "导出只有管理员可以进行" })).catch((e) => this.setData({ error: e.message }));
  },
  onHide: ui.privacyHide,
  set(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value, file: null });
  },
  quick(e) {
    const r = e.currentTarget.dataset.r;
    const t = this.data.today;
    const from = r === "month" ? t.slice(0, 7) + "-01" : r === "year" ? t.slice(0, 4) + "-01-01" : r === "90" ? b2.addDays(t, -89) : "";
    this.setData({ from, to: r === "all" ? "" : t, file: null });
  },
  build() {
    const d = this.data;
    if (d.from && d.to && d.from > d.to) return this.setData({ error: "开始日期不能晚于结束日期" });
    const filters = { ...(d.from ? { from: d.from } : {}), ...(d.to ? { to: d.to } : {}), ...(d.search.trim() ? { search: d.search.trim() } : {}) };
    this.setData({ progress: 0 });
    ui.run(this, () => ui.buildCsv(filters, (p) => this.setData({ progress: p }))).then((f) => f && this.setData({ file: f }));
  },
  send() {
    const f = this.data.file;
    if (!f) return;
    wx.shareFileMessage({
      filePath: f.path,
      fileName: f.name,
      fail: (e) => !/cancel/.test((e && e.errMsg) || "") && this.setData({ error: "没能发送，请更新微信后再试" }),
    });
  },
});

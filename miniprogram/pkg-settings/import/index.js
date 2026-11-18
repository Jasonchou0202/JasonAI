// 导入飞书历史 Excel（方案对照表 10a）：本机解析（和网页同一个 parseGrid、同一个文件指纹）→ 云端预检 → 确认后分批提交
const lib = require("../lib/settings-lib.js");
const { call, bigField, money, whoAmI } = require("../../utils/b3");
let rows = null; // 只放内存，不写本机缓存
let meta = null;
Page({
  data: { busy: false, status: "", preview: null, done: "", error: "", total: 0, percent: 0 },
  onLoad() {
    whoAmI().then((me) => !me.admin && wx.redirectTo({ url: "/pkg-settings/index/index" })).catch(() => {});
  },
  onUnload() {
    rows = null;
    meta = null;
  },
  pick() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["xlsx", "xls", "csv"],
      success: (r) => this.read(r.tempFiles[0]),
    });
  },
  read(file) {
    if (!file) return;
    if (file.size > lib.IMPORT_MAX_BYTES) return this.setData({ error: "请选择10MB以内的表格" });
    this.setData({ busy: true, status: "正在检查表格…", error: "", done: "" });
    wx.getFileSystemManager().readFile({
      filePath: file.path,
      success: (res) => {
        let p;
        try {
          p = lib.readExcel(res.data, file.name);
        } catch (e) {
          return this.setData({ busy: false, error: e.message || "表格读不出来" });
        }
        rows = p.rows;
        meta = { digest: p.digest, fileName: p.fileName };
        const hasError = p.issues.some((i) => i.kind === "error");
        const show = (extra) => {
          const s = lib.previewSummary({ ...p, ...extra });
          this.setData({
            busy: false,
            status: "",
            preview: { ...s, already: !!(extra && extra.alreadyImported), revenueText: money(s.totals.revenue), profitText: money(s.totals.profit) },
          });
        };
        if (!p.rows.length || hasError) return show();
        call("miniapp.import.preview", { ...bigField(JSON.stringify(p.rows), "rowsJson", "rowsUrl"), digest: p.digest })
          .then((r) => show({ duplicateRows: r.duplicateRows, totals: r.totals, months: r.months, alreadyImported: r.alreadyImported }))
          .catch((e) => this.setData({ busy: false, error: e.message }));
      },
      fail: () => this.setData({ busy: false, error: "文件读不出来，请重新选" }),
    });
  },
  commit() {
    if (!rows || !meta || this.data.busy) return;
    wx.showModal({
      title: "确认导入",
      content: `把 ${rows.length} 条销售记录导入账本？中途断网可以重试，已处理的行不会重复。`,
      confirmText: "导入",
      confirmColor: "#D97757",
      success: (m) => m.confirm && this.loop(),
    });
  },
  loop() {
    const body = { ...bigField(JSON.stringify(rows), "rowsJson", "rowsUrl"), digest: meta.digest, fileName: meta.fileName };
    this.setData({ busy: true, total: rows.length, percent: 0, status: "正在导入…" });
    const step = () =>
      call("miniapp.import.commit", body).then((r) => {
        const n = r.processed == null ? r.count : r.processed;
        this.setData({ status: `已处理 ${n} / ${rows.length} 条`, percent: Math.round((n / rows.length) * 100) });
        return r.done === false ? step() : r;
      });
    step()
      .then((r) => {
        rows = null;
        this.setData({ busy: false, preview: null, done: r.repeated ? "此文件已经导入，未重复添加" : `已导入 ${r.count} 条销售记录` });
      })
      .catch((e) => this.setData({ busy: false, error: e.message + "；可以重试，不会重复导入已处理的行。" }));
  },
  reset() {
    rows = null;
    meta = null;
    this.setData({ preview: null, done: "", error: "", busy: false, status: "" });
  },
});

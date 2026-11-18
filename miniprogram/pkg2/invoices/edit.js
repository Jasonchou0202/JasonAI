// 开票录入：按销售打开。没有开票记录时可「需要开票」；有记录时改状态、金额、抬头、发票号/日期、寄送去向、附件、备注；
// 还没开出来的可以「取消开票」。状态流程、校验和网页一致（云端 invoices.update 同样校验）。
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { loading: true, error: "", busy: false, saleId: "", rec: null, steps: [], status: "", amount: "", title: "", invoiceNo: "", issuedOn: "", sentTo: "", note: "", files: [], filesOn: false, issued: false, locked: false, head: "", today: "" },
  onLoad(q) {
    this.setData({ saleId: (q && q.saleId) || "", today: b2.today() });
  },
  onShow() {
    ui.privacyShow();
    if (!this.loaded) this.load();
  },
  onHide: ui.privacyHide,
  load() {
    return ui
      .call("invoices.list", { month: "all" })
      .then((r) => {
        this.loaded = true;
        const rec = r.items.find((x) => x.saleId === this.data.saleId) || null;
        if (!rec) return this.setData({ loading: false, rec: null, filesOn: r.filesEnabled });
        this.fill(rec, r.filesEnabled);
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  fill(rec, filesOn) {
    this.rec = rec;
    this.setData({
      loading: false, error: "", rec: b2.invoiceRow(rec), filesOn,
      head: `${rec.productName} · ${rec.saleDate.replace(/-/g, ".")} · 销售额 ${b2.yuan(rec.saleRevenue)}`,
      steps: b2.invoiceSteps(rec.status), status: rec.status, amount: b2.invoiceAmountInput(rec.amount), title: rec.title || "",
      invoiceNo: rec.invoiceNo || "", issuedOn: rec.issuedOn || b2.today(), sentTo: rec.sentTo || "", note: rec.note || "",
      files: (rec.files || []).map((f) => ({ ...f, sizeText: b2.sizeLabel(f.size) })),
      issued: b2.ISSUED_LIKE(rec.status), locked: rec.status === "void" || rec.status === "red",
    });
  },
  turnOn() {
    ui.run(this, () => ui.call("invoices.toggle", { saleId: this.data.saleId, on: true })).then((r) => {
      if (!r) return;
      wx.showToast({ title: r.record.status === "pending" ? "已加入待开票" : "已加入，等客户资料", icon: "none" });
      this.loaded = false;
      this.load();
    });
  },
  turnOff() {
    ui.confirm("取消开票", "这笔销售不再需要开票？", "取消开票").then(
      (y) => y && ui.run(this, () => ui.call("invoices.toggle", { saleId: this.data.saleId, on: false }), "已取消开票").then((ok) => ok && setTimeout(() => wx.navigateBack(), 600)),
    );
  },
  pickStatus(e) {
    if (this.data.locked) return;
    const s = e.currentTarget.dataset.id;
    this.setData({ status: s, issued: b2.ISSUED_LIKE(s) });
  },
  input(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value });
  },
  addFiles() {
    if (this.data.files.length >= b2.INVOICE_FILE_MAX) return this.setData({ error: `最多 ${b2.INVOICE_FILE_MAX} 个附件` });
    ui.chooseFiles(b2.INVOICE_FILE_MAX - this.data.files.length, ["pdf", "png", "jpg", "jpeg"])
      .then((list) => {
        const bad = list.map((f) => b2.invoiceFileCheck(f, "invoice")).filter(Boolean);
        const ok = list.filter((f) => !b2.invoiceFileCheck(f, "invoice"));
        if (bad.length) this.setData({ error: bad[0] });
        let chain = Promise.resolve();
        ok.forEach((f) => {
          chain = chain.then(() => ui.upload(f, "invoices.files.upload", "invoice").then((r) => this.setData({ files: [...this.data.files, { ...r, sizeText: b2.sizeLabel(r.size), fresh: true }] })));
        });
        return ui.run(this, () => chain);
      })
      .catch((e) => this.setData({ error: e.message }));
  },
  photo() {
    ui.choosePhotos(1).then((list) => list.length && ui.run(this, () => ui.upload(list[0], "invoices.files.upload", "invoice").then((r) => this.setData({ files: [...this.data.files, { ...r, sizeText: b2.sizeLabel(r.size), fresh: true }] }))));
  },
  removeFile(e) {
    const i = Number(e.currentTarget.dataset.i);
    const f = this.data.files[i];
    if (f && f.fresh) ui.call("invoices.files.discard", { fileIDs: [f.fileID] }).catch(() => undefined);
    this.setData({ files: this.data.files.filter((_, j) => j !== i) });
  },
  openFile(e) {
    const i = Number(e.currentTarget.dataset.i);
    const f = this.data.files[i];
    if (!f || f.fresh) return wx.showToast({ title: "保存后可预览", icon: "none" });
    const saved = (this.rec.files || []).findIndex((x) => x.fileID === f.fileID);
    ui.run(this, () => ui.openAttachment("invoices.files.urls", this.rec.id, saved));
  },
  save() {
    const d = this.data;
    let amount;
    try {
      amount = b2.parseInvoiceAmount(d.amount);
    } catch (e) {
      return this.setData({ error: e.message });
    }
    ui.run(this, () =>
      ui.call("invoices.update", {
        id: this.rec.id,
        revision: this.rec.revision,
        status: d.status,
        amount,
        title: d.title,
        ...(d.issued ? { invoiceNo: d.invoiceNo, issuedOn: d.issuedOn } : {}),
        ...(d.status === "sent" ? { sentTo: d.sentTo } : {}),
        files: d.files.map((f) => ({ fileID: f.fileID, name: f.name, type: f.type, size: f.size })),
        note: d.note,
      }),
    ).then((r) => {
      if (!r) return;
      wx.showToast({ title: `已保存 · ${b2.invoiceStatusLabel(r.record.status)}`, icon: "none" });
      setTimeout(() => wx.navigateBack(), 700);
    });
  },
});

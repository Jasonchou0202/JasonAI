// 客户开票信息：粘贴文字或逐项填写（抬头、税号、地址电话、开户行账号、收票邮箱）+ 资料文件；资料齐了待收资料的自动转待开票
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { loading: true, error: "", busy: false, customerId: "", name: "", mode: "text", text: "", fields: [], files: [], complete: false, filesOn: false, open: 0 },
  onLoad(q) {
    this.setData({ customerId: (q && q.customerId) || "", name: (q && q.name && decodeURIComponent(q.name)) || "" });
  },
  onShow() {
    ui.privacyShow();
    if (!this.loaded) this.load();
  },
  onHide: ui.privacyHide,
  load() {
    return ui
      .call("invoices.profile.get", { customerId: this.data.customerId })
      .then((v) => {
        this.loaded = true;
        this.view = v;
        const p = v.profile;
        const f = (p && p.fields) || {};
        this.setData({
          loading: false, error: "", complete: v.complete, filesOn: v.filesEnabled, open: v.open,
          mode: p && !p.text && Object.keys(f).length ? "fields" : "text",
          text: (p && p.text) || "",
          fields: b2.FIELD_KEYS.map((k) => ({ k, label: b2.FIELD_LABEL[k], v: f[k] || "" })),
          files: ((p && p.files) || []).map((x) => ({ ...x, sizeText: b2.sizeLabel(x.size) })),
        });
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  setMode(e) { this.setData({ mode: e.currentTarget.dataset.m }); },
  onText(e) { this.setData({ text: e.detail.value }); },
  onField(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ [`fields[${i}].v`]: e.detail.value });
  },
  addFiles() {
    ui.chooseFiles(b2.INVOICE_FILE_MAX - this.data.files.length, ["pdf", "doc", "docx", "txt", "png", "jpg", "jpeg"])
      .then((list) => {
        const bad = list.map((f) => b2.invoiceFileCheck(f, "profile")).filter(Boolean);
        if (bad.length) this.setData({ error: bad[0] });
        let chain = Promise.resolve();
        list.filter((f) => !b2.invoiceFileCheck(f, "profile")).forEach((f) => {
          chain = chain.then(() => ui.upload(f, "invoices.files.upload", "profile").then((r) => this.setData({ files: [...this.data.files, { ...r, sizeText: b2.sizeLabel(r.size), fresh: true }] })));
        });
        return ui.run(this, () => chain);
      })
      .catch((e) => this.setData({ error: e.message }));
  },
  removeFile(e) {
    const i = Number(e.currentTarget.dataset.i);
    const f = this.data.files[i];
    if (f && f.fresh) ui.call("invoices.files.discard", { fileIDs: [f.fileID] }).catch(() => undefined);
    this.setData({ files: this.data.files.filter((_, j) => j !== i) });
  },
  openFile(e) {
    const f = this.data.files[Number(e.currentTarget.dataset.i)];
    if (!f || f.fresh) return wx.showToast({ title: "保存后可预览", icon: "none" });
    const saved = ((this.view.profile && this.view.profile.files) || []).findIndex((x) => x.fileID === f.fileID);
    ui.run(this, () => ui.openAttachment("invoices.files.urls", this.view.profile.id, saved));
  },
  save() {
    const d = this.data;
    const fields = {};
    d.fields.forEach((f) => f.v.trim() && (fields[f.k] = f.v.trim()));
    ui.run(this, () =>
      ui.call("invoices.profile.save", {
        customerId: d.customerId,
        revision: (this.view.profile && this.view.profile.revision) || 0,
        text: d.text,
        fields,
        files: d.files.map((f) => ({ fileID: f.fileID, name: f.name, type: f.type, size: f.size })),
      }),
    ).then((r) => {
      if (!r) return;
      wx.showToast({ title: r.moved ? `已保存，${r.moved} 笔转为待开票` : "已保存", icon: "none" });
      this.loaded = false;
      this.load();
    });
  },
});

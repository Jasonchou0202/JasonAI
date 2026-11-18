// 记一笔报销：日期、金额（整元）、分类（可新增）、谁出的钱、凭证（拍照/聊天文件，经云函数中转 ≤4MB）、备注、状态（管理员）
// 草稿（不含凭证文件）存在本机缓存，提交成功后清掉；成员提交后是「待确认」，由管理员确认入账。
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
const DRAFT = "b2-expense-draft";
Page({
  data: {
    loading: true, error: "", busy: false, admin: false, progress: "",
    date: "", amount: "", categories: [], categoryIndex: -1, payers: [], payerIndex: 0,
    hasInvoice: false, note: "", status: "pending_reimburse", receiptsOn: false,
    files: [], kinds: [], kindIndex: 0, adding: false, newCat: "", minDate: "", today: "",
  },
  onLoad() {
    const today = b2.today();
    this.requestId = b2.requestId();
    const kinds = b2.RECEIPT_KINDS.map((k) => ({ id: k, label: b2.RECEIPT_KIND_LABEL[k] }));
    const draft = wx.getStorageSync(DRAFT) || {};
    this.setData({
      today, minDate: b2.EXPENSE_START_DATE, kinds,
      date: draft.date && draft.date >= b2.EXPENSE_START_DATE ? draft.date : today < b2.EXPENSE_START_DATE ? b2.EXPENSE_START_DATE : today,
      amount: draft.amount || "", note: draft.note || "", hasInvoice: !!draft.hasInvoice,
    });
    this.draftCategory = draft.categoryId || "";
    Promise.all([ui.me(), ui.call("expenses.meta")])
      .then(([me, meta]) => {
        const categories = b2.selectableCategories(meta.categories);
        const payers = [meta.owner, meta.partner];
        this.setData({
          loading: false, admin: me.admin, receiptsOn: !!meta.receiptsEnabled, categories,
          categoryIndex: categories.findIndex((c) => c.id === this.draftCategory),
          payers, payerIndex: me.uid && me.uid === meta.partner.uid ? 1 : 0,
        });
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  onShow: ui.privacyShow,
  onHide() {
    ui.privacyHide();
    this.saveDraft();
  },
  onUnload() {
    this.saveDraft();
  },
  saveDraft() {
    if (this.saved) return;
    const d = this.data;
    const cat = d.categories[d.categoryIndex];
    wx.setStorageSync(DRAFT, { date: d.date, amount: d.amount, note: d.note, hasInvoice: d.hasInvoice, categoryId: cat ? cat.id : "" });
  },
  onDate(e) { this.setData({ date: e.detail.value }); },
  onAmount(e) { this.setData({ amount: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onCategory(e) { this.setData({ categoryIndex: Number(e.currentTarget.dataset.i) }); },
  onPayer(e) { this.setData({ payerIndex: Number(e.currentTarget.dataset.i) }); },
  onInvoice(e) { this.setData({ hasInvoice: !!e.detail.value }); },
  onStatus(e) { this.setData({ status: e.currentTarget.dataset.s }); },
  onKind(e) { this.setData({ kindIndex: Number(e.currentTarget.dataset.i) }); },
  toggleAdd() { this.setData({ adding: !this.data.adding, newCat: "" }); },
  onNewCat(e) { this.setData({ newCat: e.detail.value }); },
  addCategory() {
    const name = this.data.newCat.trim();
    if (!name) return;
    ui.run(this, () => ui.call("expenses.categories.create", { name, requestId: b2.requestId() })).then((row) => {
      if (!row) return;
      const categories = [...this.data.categories.filter((c) => c.id !== row.id), row];
      this.setData({ categories, categoryIndex: categories.length - 1, adding: false, newCat: "" });
    });
  },
  pick(list) {
    const kind = this.data.kinds[this.data.kindIndex].id;
    const files = this.data.files.slice();
    const problems = [];
    for (const f of list) {
      if (files.length >= b2.RECEIPT_MAX_FILES) {
        problems.push(`一笔最多 ${b2.RECEIPT_MAX_FILES} 个凭证`);
        break;
      }
      const r = b2.receiptEntry(f, kind);
      if (r.error) problems.push(r.error);
      else files.push({ key: b2.requestId(), path: f.path, name: f.name, size: f.size, sizeText: b2.sizeLabel(f.size), kind, kindLabel: b2.RECEIPT_KIND_LABEL[kind], image: /^image\//.test(r.type) });
    }
    this.setData({ files, error: problems.join("；") });
  },
  photo() {
    ui.choosePhotos(b2.RECEIPT_MAX_FILES - this.data.files.length).then((l) => this.pick(l)).catch((e) => this.setData({ error: e.message }));
  },
  chatFile() {
    ui.chooseFiles(b2.RECEIPT_MAX_FILES - this.data.files.length, ["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"])
      .then((l) => this.pick(l))
      .catch((e) => this.setData({ error: e.message }));
  },
  removeFile(e) {
    const key = e.currentTarget.dataset.key;
    const f = this.data.files.find((x) => x.key === key);
    if (f && f.uploaded) ui.call("expenses.receipts.discard", { fileIDs: [f.uploaded.fileID] }).catch(() => undefined);
    this.setData({ files: this.data.files.filter((x) => x.key !== key) });
  },
  save() {
    const d = this.data;
    const cat = d.categories[d.categoryIndex];
    let amount;
    try {
      amount = b2.parseYuan(d.amount);
      if (amount <= 0) throw new Error("金额要大于 0");
    } catch (e) {
      return this.setData({ error: e.message });
    }
    if (!cat) return this.setData({ error: "请选一个分类" });
    ui.run(this, () => {
      const todo = d.files.filter((f) => !f.uploaded);
      let chain = Promise.resolve();
      todo.forEach((f, i) => {
        chain = chain.then(() => {
          this.setData({ progress: `正在上传凭证 ${i + 1}/${todo.length}…` });
          return ui.upload(f, "expenses.receipts.upload").then((r) => {
            f.uploaded = r;
          });
        });
      });
      return chain.then(() => {
        this.setData({ progress: "正在保存…" });
        const receipts = d.files.map((f) => ({ fileID: f.uploaded.fileID, name: f.name.slice(0, 120), type: f.uploaded.type, size: f.uploaded.size, kind: f.kind }));
        return ui.call("expenses.create", {
          requestId: this.requestId,
          expense: {
            date: d.date,
            amount,
            categoryId: cat.id,
            categoryName: cat.name,
            paidBy: d.payers[d.payerIndex].uid,
            hasInvoice: d.receiptsOn ? b2.deriveHasInvoice(receipts, false) : d.hasInvoice,
            ...(receipts.length ? { receipts } : {}),
            note: d.note,
            status: d.admin ? d.status : "pending_confirm",
          },
        });
      });
    }, d.admin ? "已记下" : "已提交").then((r) => {
      this.setData({ progress: "" });
      if (!r) return;
      this.saved = true;
      wx.removeStorageSync(DRAFT);
      setTimeout(() => wx.navigateBack(), 600);
    });
  },
});

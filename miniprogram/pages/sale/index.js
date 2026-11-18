// 记一笔 / 编辑销售：草稿只存本机；保存走 sales.create / sales.update（requestId 固定，重试不会记重）
// 顺手建客户日程：先存销售，再按客户名找到（合并后的）客户建日程；日程失败只提示重试，不会重复记销售
const D = require("../../lib/domain");
const { call } = require("../../utils/api");
const session = require("../../utils/session");
const draft = require("../../utils/draft");

const NEW_KEY = "draft-sale-new";
const REMINDER_LABELS = D.REMINDERS.map((r) => r.label);

Page({
  data: {
    edit: null,
    form: null,
    quick: [],
    productNames: [],
    hints: [],
    profit: "¥ —",
    dateText: "今天",
    payer: null,
    reminderLabels: REMINDER_LABELS,
    reminderIndex: 0,
    busy: false,
    error: "",
    pendingSchedule: null,
  },
  onLoad(q) {
    this.editId = q && q.id;
    wx.setNavigationBarTitle({ title: this.editId ? "编辑销售" : "记一笔" });
  },
  onShow() {
    session.protect(true);
    this.init();
  },
  onHide() {
    session.protect(false);
  },
  onUnload() {
    session.protect(false);
  },
  init() {
    const day = D.today();
    return session
      .load()
      .then((me) => {
        this.me = me;
        const payerOn = !!(me.salesPayerEnabled && me.expensesEnabled);
        return Promise.all([
          call("products.list"),
          call("customers").catch(() => []),
          call("export").catch(() => []),
          this.editId ? call("sales.get", { id: this.editId }) : Promise.resolve(null),
          payerOn ? call("expenses.meta").catch(() => null) : Promise.resolve(null),
        ]);
      })
      .then(([products, customers, sales, edit, meta]) => {
        this.products = products || [];
        this.customers = customers || [];
        this.edit = edit;
        const key = this.key();
        let form = this.data.form || draft.read(key) || (edit ? D.draftFromSale(edit) : D.freshDraft(day));
        if (!edit && !form.dateTouched && form.date !== day) form = Object.assign({}, form, { date: day });
        const groups = D.productGroups(this.products);
        this.picker = groups.reduce((all, g) => all.concat(g.items), []);
        const payer = meta
          ? [
              { uid: meta.owner.uid, name: meta.owner.name },
              { uid: meta.partner.uid, name: meta.partner.name },
            ]
          : null;
        this.setData({
          edit: edit ? { id: edit.id } : null,
          quick: D.quickProducts(sales || [], this.products, day).map((p) => ({ id: p.id, name: p.name })),
          productNames: this.picker.map((p) => (p.category ? p.category + " · " : "") + p.name),
          payer,
          error: "",
        });
        this.apply(form);
      })
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ error: e.message });
      });
  },
  key() {
    return this.editId ? "draft-sale-" + this.editId : NEW_KEY;
  },
  apply(form) {
    const day = D.today();
    const reminder = form.scheduleReminder || "both";
    this.setData({
      form,
      profit: D.draftProfit(form, this.edit || undefined),
      dateText: form.date === day ? "今天" : form.date.replace(/-/g, " / "),
      reminderIndex: Math.max(0, D.REMINDERS.findIndex((r) => r.value === reminder)),
      paidBy: form.paidBy || (this.edit && (this.edit.paidBy || this.edit.createdBy)) || (this.me && this.me.uid) || "",
    });
    if (D.draftDirty(form, day) || this.editId) draft.write(this.key(), form);
  },
  patch(p) {
    this.apply(Object.assign({}, this.data.form, p));
  },
  input(e) {
    const k = e.currentTarget.dataset.k;
    const v = e.detail.value;
    const p = { [k]: v };
    if (k === "productName") p.productId = (this.products.find((x) => x.name === v.trim()) || {}).id || "";
    this.patch(p);
    if (k === "customer") this.setData({ hints: D.customerHints(this.customers, v) });
  },
  pickHint(e) {
    this.patch({ customer: e.currentTarget.dataset.name });
    this.setData({ hints: [] });
  },
  pickQuick(e) {
    const p = this.products.find((x) => x.id === e.currentTarget.dataset.id);
    if (p) this.apply(D.pickProduct(this.data.form, p));
  },
  pickProduct(e) {
    const p = this.picker[Number(e.detail.value)];
    if (p) this.apply(D.pickProduct(this.data.form, p));
  },
  pickDate(e) {
    this.patch({ date: e.detail.value, dateTouched: true });
  },
  pickPayer(e) {
    this.patch({ paidBy: e.currentTarget.dataset.uid });
  },
  toggleSchedule(e) {
    const on = e.detail.value;
    const f = this.data.form;
    this.patch(
      Object.assign(
        { schedule: on, scheduleReminder: f.scheduleReminder || "both", scheduleRequestId: f.scheduleRequestId || D.requestId() },
        on ? D.scheduleDefaults(f) : {},
      ),
    );
  },
  pickScheduleDate(e) {
    this.patch({ scheduleDate: e.detail.value });
  },
  pickScheduleTime(e) {
    this.patch({ scheduleTime: e.detail.value });
  },
  pickReminder(e) {
    this.patch({ scheduleReminder: D.REMINDERS[Number(e.detail.value)].value });
  },
  saveStay() {
    this.save(true);
  },
  saveLeave() {
    this.save(false);
  },
  save(stay) {
    if (this.data.busy) return;
    const form = this.data.form;
    let plan;
    try {
      plan = D.prepareSave(form, { edit: this.edit || undefined, payerOn: !!this.data.payer });
    } catch (e) {
      return this.setData({ error: e.message });
    }
    this.setData({ busy: true, error: "" });
    const saved = this.edit
      ? call("sales.update", { id: this.edit.id, revision: this.edit.revision, requestId: form.requestId, sale: plan.sale })
      : call("sales.create", { requestId: form.requestId, sale: plan.sale });
    saved
      .then(() => (plan.schedule ? this.createSchedule(plan.schedule).then(() => "", (e) => e.message) : ""))
      .then((scheduleError) => {
        draft.remove(this.key());
        const day = D.today();
        if (scheduleError) {
          this.apply(D.freshDraft(form.dateTouched ? form.date : day));
          this.setData({ busy: false, pendingSchedule: plan.schedule, error: "销售已保存，日程还没建成：" + scheduleError + "。可点「重试建日程」。" });
          return;
        }
        wx.showToast({ title: plan.schedule ? "已保存，日程已添加" : "已保存", icon: "success" });
        this.setData({ busy: false });
        if (stay && !this.edit) {
          const next = Object.assign(D.freshDraft(form.dateTouched ? form.date : day), {
            dateTouched: form.dateTouched,
            productId: form.productId,
            productName: form.productName,
            revenue: form.revenue,
            cost: form.cost,
          });
          this.apply(next);
        } else setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/details/index" }) }), 400);
      })
      .catch((e) => this.setData({ busy: false, error: e.message }));
  },
  createSchedule(p) {
    return call("customers.list").then((list) => {
      const id = D.customerRootByName(list, p.customer);
      if (!id) throw new Error("没找到这位客户的档案");
      return call("tasks.create", {
        requestId: p.requestId,
        task: { customerId: id, at: p.at, title: p.title, feedback: "", nextAction: p.nextAction || "", reminder: p.reminder },
      });
    });
  },
  retrySchedule() {
    const p = this.data.pendingSchedule;
    if (!p || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    this.createSchedule(p)
      .then(() => {
        this.setData({ busy: false, pendingSchedule: null });
        wx.showToast({ title: "客户日程已添加", icon: "success" });
      })
      .catch((e) => this.setData({ busy: false, error: "销售已保存，日程还没建成：" + e.message + "。可点「重试建日程」。" }));
  },
  discard() {
    wx.showModal({
      title: "清空草稿",
      content: "填了的内容都会清空，确定吗？",
      success: (r) => {
        if (!r.confirm) return;
        draft.remove(this.key());
        this.apply(this.edit ? D.draftFromSale(this.edit) : D.freshDraft(D.today()));
      },
    });
  },
});

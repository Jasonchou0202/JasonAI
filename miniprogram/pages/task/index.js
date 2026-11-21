// 新建 / 编辑客户日程（tasks.create / tasks.update）；12:30–14:00 不排日程，和网页同一条规则
const D = require("../../lib/domain");
const { call } = require("../../utils/api");
const session = require("../../utils/session");
const { offerTask } = require("../../utils/subscribe");

Page({
  data: { form: null, edit: false, search: "", matches: [], reminderLabels: D.REMINDERS.map((r) => r.label), reminderIndex: 0, busy: false, error: "" },
  onLoad(q) {
    this.q = q || {};
    wx.setNavigationBarTitle({ title: this.q.id ? "编辑日程" : "新建日程" });
    session.protect(true);
    session
      .load()
      .then(() => Promise.all([call("customers.list"), this.q.id ? call("tasks.get", { id: this.q.id }) : Promise.resolve(null)]))
      .then(([customers, task]) => {
        this.customers = (customers || []).filter((c) => !c.mergedInto);
        this.names = D.customerNames(customers || []);
        this.task = task;
        let form = task ? D.draftFromTask(task, this.names) : D.freshTask(this.q.date || D.today());
        if (!task && this.q.customer) {
          const id = D.customerRootByName(customers || [], decodeURIComponent(this.q.customer));
          if (id) form = Object.assign(form, { customerId: id, customerName: D.displayCustomerName(this.names.get(id) || "") });
        }
        this.setForm(form, { edit: !!task });
      })
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ error: e.message });
      });
  },
  onUnload() {
    session.protect(false);
  },
  setForm(form, extra) {
    this.setData(Object.assign({ form, reminderIndex: Math.max(0, D.REMINDERS.findIndex((r) => r.value === form.reminder)) }, extra || {}));
  },
  patch(p) {
    this.setForm(Object.assign({}, this.data.form, p));
  },
  typeSearch(e) {
    const q = e.detail.value.trim().toLocaleLowerCase();
    this.setData({
      search: e.detail.value,
      matches: q
        ? this.customers
            .filter((c) => c.name.toLocaleLowerCase().includes(q))
            .slice(0, 8)
            .map((c) => ({ id: c.id, name: D.displayCustomerName(c.name) }))
        : [],
    });
  },
  pickCustomer(e) {
    const { id, name } = e.currentTarget.dataset;
    this.patch({ customerId: id, customerName: name });
    this.setData({ search: "", matches: [] });
  },
  input(e) {
    this.patch({ [e.currentTarget.dataset.k]: e.detail.value });
  },
  pickDate(e) {
    this.patch({ date: e.detail.value });
  },
  pickTime(e) {
    this.patch({ time: e.detail.value });
  },
  pickReminder(e) {
    this.patch({ reminder: D.REMINDERS[Number(e.detail.value)].value });
  },
  save() {
    if (this.data.busy) return;
    let task;
    try {
      task = D.taskInput(this.data.form);
    } catch (e) {
      return this.setData({ error: e.message });
    }
    this.setData({ busy: true, error: "" });
    const f = this.data.form;
    const req = this.task
      ? call("tasks.update", { id: this.task.id, revision: this.task.revision, requestId: f.requestId, task })
      : call("tasks.create", { requestId: f.requestId, task });
    // 先弹出订阅（仍在点击路径里），再等保存结果
    offerTask();
    req
      .then(() => {
        wx.showToast({ title: "已保存", icon: "success" });
        setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/calendar/index" }) }), 400);
      })
      .catch((e) => this.setData({ busy: false, error: e.message }));
  },
});

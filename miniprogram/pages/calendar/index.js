// 客户日程：月历（每天有几条待办/已完成）+ 选中那天的列表 + 今日/明日/逾期；新建、完成、重开、删除、恢复都和网页一样
const D = require("../../lib/domain");
const { call } = require("../../utils/api");
const { offerTask } = require("../../utils/subscribe");
const session = require("../../utils/session");

Page({
  data: {
    month: "",
    selected: "",
    grid: null,
    view: "day",
    rows: [],
    groups: null,
    loading: true,
    error: "",
    weekdays: ["一", "二", "三", "四", "五", "六", "日"],
  },
  onLoad() {
    const day = D.today();
    this.setData({ month: day.slice(0, 7), selected: day });
  },
  onShow() {
    session.protect(true);
    this.load();
  },
  onHide() {
    session.protect(false);
  },
  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },
  load(force) {
    const day = D.today();
    const range = D.monthRange(this.data.month);
    this.setData({ loading: true, error: "" });
    return session
      .load(force)
      .then(() =>
        Promise.all([
          call("customers.list"),
          call("tasks.list", range),
          call("tasks.list", { to: D.addDays(day, 1) }),
          this.data.view === "deleted" ? call("tasks.list", { deleted: true }) : Promise.resolve([]),
        ]),
      )
      .then(([customers, monthTasks, near, deleted]) => {
        this.names = D.customerNames(customers || []);
        this.monthTasks = monthTasks || [];
        this.near = near || [];
        this.deleted = deleted || [];
        this.render();
      })
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ loading: false, error: e.message });
      });
  },
  render() {
    const day = D.today();
    const now = Date.now();
    const row = (t) => D.taskRow(t, this.names, now);
    const a = D.agenda(this.near, day, now);
    const dayRows = this.monthTasks.filter((t) => !t.deletedAt && D.beijingDay(t.at) === this.data.selected);
    this.setData({
      loading: false,
      grid: D.monthGrid(this.data.month, this.monthTasks, this.data.selected, day),
      rows: (this.data.view === "deleted" ? this.deleted : D.sortTasksTodayFirst(dayRows, day)).map(row),
      groups: [
        { key: "overdue", title: "逾期未完成", rows: a.overdue.map(row) },
        { key: "today", title: "今天", rows: a.today.map(row) },
        { key: "tomorrow", title: "明天", rows: a.tomorrow.map(row) },
      ],
      selectedText: this.data.selected === day ? "今天" : D.dateLabel(this.data.selected),
    });
  },
  shiftMonth(e) {
    const month = D.shiftMonth(this.data.month, Number(e.currentTarget.dataset.n));
    this.setData({ month, selected: month + "-01" });
    this.load();
  },
  pickDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date.startsWith(this.data.month)) {
      this.setData({ month: date.slice(0, 7), selected: date });
      return this.load();
    }
    this.setData({ selected: date, view: "day" });
    this.render();
  },
  backToday() {
    const day = D.today();
    this.setData({ month: day.slice(0, 7), selected: day, view: "day" });
    this.load();
  },
  setView(e) {
    this.setData({ view: e.currentTarget.dataset.v });
    this.load();
  },
  findTask(id) {
    return this.monthTasks.concat(this.near, this.deleted).find((t) => t.id === id);
  },
  openTask(e) {
    const id = e.currentTarget.dataset.id;
    const t = this.findTask(id);
    if (!t) return;
    const items = t.deletedAt ? ["恢复"] : [t.completedAt ? "重新打开" : "标记完成", "编辑", "删除"];
    wx.showActionSheet({
      itemList: items,
      success: (r) => {
        const pick = items[r.tapIndex];
        if (pick === "编辑") return wx.navigateTo({ url: "/pages/task/index?id=" + id });
        const action = { 标记完成: "tasks.complete", 重新打开: "tasks.reopen", 删除: "tasks.delete", 恢复: "tasks.restore" }[pick];
        const go = () =>
          call(action, { id, revision: t.revision, requestId: D.requestId() })
            .then(() => {
              wx.showToast({ title: pick === "删除" ? "已删除" : "已更新", icon: "success" });
              this.load();
            })
            .catch((err) => this.setData({ error: err.message }));
        if (pick === "标记完成") offerTask();
        if (pick !== "删除") return go();
        wx.showModal({ title: "删除这条日程", content: t.title + "。删除后可在「已删除」里恢复。", confirmText: "删除", confirmColor: "#9E2A1E", success: (m) => m.confirm && go() });
      },
    });
  },
  newTask() {
    wx.navigateTo({ url: "/pages/task/index?date=" + this.data.selected });
  },
});

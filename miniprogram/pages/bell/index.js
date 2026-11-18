// 铃铛：今天还没完成的日程（与网页 DailyReminders 同一个 dailyPendingTasks）；每次打开、切回前台都刷新
const D = require("../../lib/domain");
const { call } = require("../../utils/api");
const session = require("../../utils/session");

Page({
  data: { rows: [], count: 0, loading: true, error: "", day: "" },
  onShow() {
    session.protect(true);
    this.load();
  },
  onHide() {
    session.protect(false);
  },
  onUnload() {
    session.protect(false);
  },
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
  load() {
    const day = D.today();
    return session
      .load()
      .then(() => Promise.all([call("tasks.list", { from: day, to: day }), call("customers.list")]))
      .then(([tasks, customers]) => {
        this.tasks = tasks || [];
        const names = D.customerNames(customers || []);
        const b = D.bell(this.tasks, day);
        this.setData({ loading: false, error: "", day: D.dateLabel(day), count: b.count, rows: b.rows.map((t) => D.taskRow(t, names)) });
      })
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ loading: false, error: e.message });
      });
  },
  done(e) {
    const t = this.tasks.find((x) => x.id === e.currentTarget.dataset.id);
    if (!t) return;
    call("tasks.complete", { id: t.id, revision: t.revision, requestId: D.requestId() })
      .then(() => {
        wx.showToast({ title: "已完成", icon: "success" });
        this.load();
      })
      .catch((err) => this.setData({ error: err.message }));
  },
  open(e) {
    wx.navigateTo({ url: "/pages/task/index?id=" + e.currentTarget.dataset.id });
  },
  calendar() {
    wx.switchTab({ url: "/pages/calendar/index" });
  },
});

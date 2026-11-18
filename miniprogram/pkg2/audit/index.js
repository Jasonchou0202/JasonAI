// 操作日志（管理员看全部）/ 我的操作记录（成员只看自己的，云端强制）：按时间范围筛选、翻页；文案复用网页 audit-text
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { loading: true, error: "", busy: false, admin: false, range: "7", ranges: b2.AUDIT_RANGES, rows: [], next: null },
  onShow() {
    ui.privacyShow();
    if (!this.loaded) this.init();
  },
  onHide: ui.privacyHide,
  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },
  init() {
    return ui
      .me()
      .then((me) => {
        this.loaded = true;
        wx.setNavigationBarTitle({ title: me.admin ? "操作日志" : "我的操作记录" });
        this.setData({ admin: me.admin });
        const people = me.admin ? ui.call("members.list").then((d) => d.members).catch(() => []) : Promise.resolve([]);
        return Promise.all([people, ui.call("customers.list", {}).catch(() => [])]).then(([ms, cs]) => {
          const pn = {};
          ms.forEach((m) => (pn[m.uid] = m.name));
          if (me.ownerUid) pn[me.ownerUid] = "管理员";
          const cn = {};
          cs.forEach((c) => (cn[c.id] = b2.displayCustomerName(c.name)));
          this.person = (uid) => pn[uid] || (uid && uid.indexOf("system:") === 0 ? "系统" : "");
          this.customer = (id) => cn[id];
          return this.reload();
        });
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  query(cursor) {
    const r = b2.AUDIT_RANGES.find((x) => x.id === this.data.range);
    const t = b2.today();
    return { ...(r && r.back >= 0 ? { from: b2.addDays(t, -r.back), to: t } : {}), ...(cursor ? { cursor } : {}), limit: 50 };
  },
  reload() {
    this.setData({ loading: true });
    return ui
      .call("audit.list", this.query())
      .then((d) => this.setData({ loading: false, error: "", rows: b2.auditView(d.rows, this.person, this.customer), next: d.next }))
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  more() {
    if (!this.data.next) return;
    ui.run(this, () => ui.call("audit.list", this.query(this.data.next))).then((d) => d && this.setData({ rows: [...this.data.rows, ...b2.auditView(d.rows, this.person, this.customer)], next: d.next }));
  },
  pick(e) {
    this.setData({ range: e.currentTarget.dataset.id }, () => this.reload());
  },
});

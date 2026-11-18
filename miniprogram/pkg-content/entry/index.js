// 今日获客录入（方案对照表 13）：经 miniapp 交给同一套 content 逻辑（content 函数本身不动），只给管理员
const { call, bjToday, bjAddDays, requestId, whoAmI } = require("../../utils/b3");
const SOURCES = ["抖音", "视频号", "公众号", "小红书"];
const empty = () => ({ 抖音: "", 视频号: "", 公众号: "", 小红书: "" });
const int = (v) => {
  const n = Number(String(v || "").trim() || 0);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};
Page({
  data: { today: "", date: "", wechat: "", leads: empty(), note: "", revision: 0, sum: 0, wechatNum: 0, sources: SOURCES, recent: [], busy: false, ok: "", error: "" },
  onLoad() {
    const today = bjToday();
    this.setData({ today, date: today });
    whoAmI()
      .then((me) => {
        if (!me.admin) return wx.redirectTo({ url: "/pkg-settings/index/index" });
        return this.refresh();
      })
      .catch((e) => this.setData({ error: e.message }));
  },
  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },
  refresh() {
    return Promise.all([this.loadDay(this.data.date), this.loadRecent()]).catch((e) => this.setData({ error: e.message }));
  },
  loadDay(date) {
    return call("content.daily.get", { date }).then((r) => {
      if (!r || r.deletedAt) return this.setData({ wechat: "", leads: empty(), note: "", revision: 0, sum: 0, wechatNum: 0 });
      const leads = {};
      SOURCES.forEach((s) => (leads[s] = String(r.leads[s] || 0)));
      this.setData({ wechat: String(r.wechat_adds), leads, note: r.note || "", revision: r.revision });
      this.total();
    });
  },
  loadRecent() {
    const to = this.data.today;
    return call("content.daily.list", { from: bjAddDays(to, -6), to }).then((rows) =>
      this.setData({
        recent: (rows || [])
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((r) => ({ date: r.date, wechat_adds: r.wechat_adds, detail: SOURCES.map((s) => `${s} ${r.leads[s] || 0}`).join(" · ") })),
      }),
    );
  },
  onDate(e) {
    this.setData({ date: e.detail.value, ok: "", error: "" });
    this.loadDay(e.detail.value).catch((err) => this.setData({ error: err.message }));
  },
  pickDay(e) {
    this.onDate({ detail: { value: e.currentTarget.dataset.date } });
  },
  onNum(e) {
    this.setData({ wechat: e.detail.value });
    this.total();
  },
  onLead(e) {
    this.setData({ ["leads." + e.currentTarget.dataset.src]: e.detail.value });
    this.total();
  },
  /** 四个来源合计要等于新增好友（和网页、content 函数同一条规则） */
  total() {
    const sum = SOURCES.reduce((a, s) => a + (int(this.data.leads[s]) || 0), 0);
    this.setData({ sum, wechatNum: int(this.data.wechat) || 0 });
  },
  onNote(e) {
    this.setData({ note: e.detail.value });
  },
  save() {
    const wechat = int(this.data.wechat);
    const leads = {};
    for (const s of SOURCES) {
      leads[s] = int(this.data.leads[s]);
      if (Number.isNaN(leads[s])) return this.setData({ error: `来自${s}的人数请填 0 或正整数` });
    }
    if (Number.isNaN(wechat)) return this.setData({ error: "微信新增好友请填 0 或正整数" });
    const sum = SOURCES.reduce((a, s) => a + leads[s], 0);
    if (sum !== wechat) return this.setData({ error: `四个来源合计 ${sum} 人，和新增好友 ${wechat} 人对不上` });
    this.setData({ busy: true, ok: "", error: "" });
    call("content.daily.save", {
      requestId: requestId(),
      ...(this.data.revision ? { revision: this.data.revision } : {}),
      date: this.data.date,
      wechat_adds: wechat,
      leads,
      note: this.data.note.trim(),
    })
      .then((row) => {
        this.setData({ busy: false, revision: row.revision, ok: `${row.date} 已保存` });
        return this.loadRecent();
      })
      .catch((e) => this.setData({ busy: false, error: e.message }));
  },
});

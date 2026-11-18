// 成员管理（只给管理员）：生成网页邀请链接并复制、撤销邀请、批准、停用、恢复；日程归属开关开时显示固定颜色、给老成员补色。
// 小程序申请的审批在第 1 批「我的 → 成员申请」里，这里只管已经入队的成员。
const ui = require("../lib/ui");
const b2 = require("../lib/b2");
Page({
  data: { loading: true, error: "", busy: false, name: "", created: null, v: null, invites: [], colors: false },
  onShow() {
    ui.privacyShow();
    this.load();
  },
  onHide: ui.privacyHide,
  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },
  load() {
    return Promise.all([ui.me(), ui.call("members.list")])
      .then(([me, d]) => {
        if (!me.admin) return this.setData({ loading: false, error: "成员管理只有管理员可以进行" });
        this.setData({
          loading: false, error: "", colors: me.colors,
          v: b2.membersView(d.members, me.ownerUid || me.uid, me.colors),
          invites: d.invites.map((i) => ({ id: i.id, name: i.name, until: b2.bjTime(i.expiresAt) })),
        });
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  onName(e) {
    this.setData({ name: e.detail.value });
  },
  invite() {
    const name = this.data.name.trim();
    if (!name) return this.setData({ error: "先填一个备注名" });
    ui.run(this, () => ui.call("members.invite.create", { name })).then((r) => {
      if (!r) return;
      this.setData({ created: { name: r.name, link: b2.inviteLink(r.code), until: b2.bjTime(r.expiresAt) }, name: "" });
      this.load();
    });
  },
  copy() {
    const c = this.data.created;
    if (c) wx.setClipboardData({ data: c.link });
  },
  act(e) {
    const { uid, a } = e.currentTarget.dataset;
    const row = this.data.v.rows.find((r) => r.uid === uid);
    const go = () => ui.run(this, () => ui.call(`members.${a}`, { uid }), a === "approve" ? "已批准" : a === "disable" ? "已停用" : "已恢复").then((ok) => ok && this.load());
    if (a !== "disable") return go();
    ui.confirm("停用成员", `停用「${row ? row.name : ""}」后，他在网页和小程序都会立刻失效，可以随时恢复。`, "停用").then((y) => y && go());
  },
  revoke(e) {
    const id = e.currentTarget.dataset.id;
    ui.confirm("撤销邀请", "撤销后这个链接就不能用了。", "撤销").then((y) => y && ui.run(this, () => ui.call("members.invite.revoke", { id }), "已撤销").then((ok) => ok && this.load()));
  },
  fill() {
    ui.run(this, () => ui.call("members.color.fill", {}), "已补色").then((ok) => ok && this.load());
  },
});

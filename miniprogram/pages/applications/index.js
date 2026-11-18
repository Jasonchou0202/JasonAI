// 成员申请（只给管理员）：批准、批准并关联已有成员、拒绝、拉黑、解除拉黑——和网页「成员管理 → 小程序申请」同一组调用
const { call } = require("../../utils/api");
const session = require("../../utils/session");

function bj(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 8 * 3600000).toISOString();
  return Number(d.slice(5, 7)) + "月" + Number(d.slice(8, 10)) + "日 " + d.slice(11, 16);
}
function phone(p) {
  return /^1\d{10}$/.test(p || "") ? p.slice(0, 3) + " " + p.slice(3, 7) + " " + p.slice(7) : p || "";
}

Page({
  data: { pending: [], blocked: [], loading: true, error: "" },
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
  load() {
    return session
      .load()
      .then((me) => {
        if (!me.owner) throw new Error("这个页面只有管理员可以看");
        return call("miniapp.apply.list");
      })
      .then((r) => {
        this.raw = r;
        this.setData({
          loading: false,
          error: "",
          pending: r.pending.map((a) => ({ id: a.id, name: a.name, phone: phone(a.phone), at: bj(a.lastAppliedAt), maybe: (a.maybe || []).map((m) => m.name).join("、") })),
          blocked: r.blocked.map((a) => ({ id: a.id, name: a.name, phone: a.phone, at: bj(a.decidedAt || a.lastAppliedAt) })),
        });
      })
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ loading: false, error: e.message });
      });
  },
  run(action, payload, confirm) {
    const go = () =>
      call(action, payload)
        .then(() => {
          wx.showToast({ title: "已处理", icon: "success" });
          this.load();
        })
        .catch((e) => this.setData({ error: e.message }));
    if (!confirm) return go();
    wx.showModal({ title: "确认", content: confirm, success: (r) => r.confirm && go() });
  },
  decide(e) {
    const a = this.raw.pending.find((x) => x.id === e.currentTarget.dataset.id);
    if (!a) return;
    const maybe = a.maybe || [];
    const items = ["批准（新成员）"].concat(maybe.map((m) => "批准并关联到「" + m.name + "」"), ["拒绝", "拉黑"]);
    wx.showActionSheet({
      itemList: items,
      success: (r) => {
        const i = r.tapIndex;
        if (i === 0) return this.run("miniapp.apply.approve", { id: a.id }, "批准「" + a.name + "」作为新成员？");
        if (i <= maybe.length) {
          const m = maybe[i - 1];
          return this.run("miniapp.apply.approve", { id: a.id, linkUid: m.uid }, "批准并关联到已有成员「" + m.name + "」？");
        }
        if (items[i] === "拒绝") return this.run("miniapp.apply.reject", { id: a.id }, "拒绝「" + a.name + "」的申请？对方 24 小时后才能再申请。");
        return this.run("miniapp.apply.block", { id: a.id }, "拉黑「" + a.name + "」这个微信？拉黑后不能再申请。");
      },
    });
  },
  unblock(e) {
    const id = e.currentTarget.dataset.id;
    const a = this.raw.blocked.find((x) => x.id === id);
    this.run("miniapp.apply.unblock", { id }, "解除「" + (a ? a.name : "") + "」的拉黑？");
  },
});

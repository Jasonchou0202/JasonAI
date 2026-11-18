// 我的：身份与微信头像、更多（管理入口）、账本设置、成员申请入口（只给管理员，带红点）、退出这个微信的绑定
const { call } = require("../../utils/api");
const session = require("../../utils/session");

const SIDE = 128;
const TARGET = 30 * 1024;
// 「我的」在 tabBar 里的下标（看板、财务、明细、日程、我的）
const ME_TAB = 4;

Page({
  data: { role: "", name: "", owner: false, pending: 0, error: "", avatarUrl: "", initial: "我", busy: false },
  onShow() {
    this.load();
  },
  load() {
    return session
      .load(true)
      .then((me) => {
        const name = me.bindName || me.name || "";
        this.setData({
          role: me.role === "admin" ? "管理员" : "成员",
          name: name,
          owner: me.owner,
          avatarUrl: me.avatarUrl || "",
          initial: (name || "我").slice(0, 1),
          error: "",
        });
        if (me.owner)
          return call("miniapp.apply.list")
            .then((r) => {
              const n = ((r && r.pending) || []).length;
              this.setData({ pending: n });
              if (n) wx.setTabBarBadge({ index: ME_TAB, text: String(n) });
              else wx.removeTabBarBadge({ index: ME_TAB });
            })
            .catch(() => {});
      })
      .catch((e) => {
        if (e.code !== "NOT_BOUND") this.setData({ error: e.message });
      });
  },
  onChooseAvatar(e) {
    const path = e && e.detail && e.detail.avatarUrl;
    if (!path || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    this.compress(path)
      .then((image) => call("miniapp.avatar.set", { image }))
      .then((r) => {
        session.clear();
        this.setData({ busy: false, avatarUrl: (r && r.avatarUrl) || this.data.avatarUrl });
        wx.showToast({ title: "头像已更新", icon: "success" });
        return this.load();
      })
      .catch((err) => this.setData({ busy: false, error: err.message || "头像未能保存，请稍后重试" }));
  },
  compress(path) {
    const page = this;
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(page)
        .select("#avatarCanvas")
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res && res[0] && res[0].node;
          if (!canvas) return reject(new Error("这台手机暂不支持裁剪头像"));
          canvas.width = SIDE;
          canvas.height = SIDE;
          const ctx = canvas.getContext("2d");
          const img = canvas.createImage();
          img.onload = () => {
            const s = Math.min(img.width, img.height);
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, SIDE, SIDE);
            ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, SIDE, SIDE);
            let q = 0.86;
            let url = canvas.toDataURL("image/jpeg", q);
            while (url.length * 0.75 > TARGET && q > 0.4) {
              q -= 0.12;
              url = canvas.toDataURL("image/jpeg", q);
            }
            if (url.length * 0.75 > TARGET) return reject(new Error("这张图压不到 30KB 以内，请换一张"));
            resolve(url);
          };
          img.onerror = () => reject(new Error("这张图片读不出来，请重新选择"));
          img.src = path;
        });
    });
  },
  hub() {
    wx.navigateTo({ url: "/pkg2/hub/index" });
  },
  settings() {
    wx.navigateTo({ url: "/pkg-settings/index/index" });
  },
  applications() {
    wx.navigateTo({ url: "/pages/applications/index" });
  },
  leave() {
    wx.showModal({
      title: "退出小程序账号",
      content: "退出后这个微信要重新申请才能使用，确定吗？",
      confirmColor: "#9E2A1E",
      success: (r) =>
        r.confirm &&
        call("miniapp.bind.leave")
          .then(() => {
            session.clear();
            wx.reLaunch({ url: "/pages/gate/index" });
          })
          .catch((e) => this.setData({ error: e.message })),
    });
  },
});

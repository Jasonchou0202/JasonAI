// 头像（方案对照表 11a）：拍照或选图 → 本机裁正方形、缩到 128×128、JPEG 压到 30KB 内 → 经 miniapp 交给原来的 members.avatar.set
const { call } = require("../../utils/b3");
const SIDE = 128;
const TARGET = 30 * 1024;
Page({
  data: { enabled: false, current: "", preview: "", initial: "我", busy: false, error: "" },
  dataUrl: "",
  onShow() {
    this.load();
  },
  load() {
    return call("members.me")
      .then((me) => {
        this.uid = me.uid;
        this.setData({ enabled: !!me.avatarsEnabled, initial: (me.name || "我").slice(0, 1) });
        if (!me.avatarsEnabled) return;
        return call("members.directory").then((d) => {
          const people = (d && d.people) || d || [];
          const self = (Array.isArray(people) ? people : []).find((p) => p.uid === me.uid);
          this.setData({ current: (self && self.avatar && self.avatar.url) || "" });
        });
      })
      .catch((e) => this.setData({ error: e.message }));
  },
  choose() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["compressed"],
      success: (r) => {
        const src = r.tempFiles[0].tempFilePath;
        if (wx.cropImage)
          wx.cropImage({ src, cropScale: "1:1", success: (c) => this.encode(c.tempFilePath), fail: () => this.encode(src) });
        else this.encode(src);
      },
    });
  },
  encode(path) {
    this.setData({ error: "" });
    wx.createSelectorQuery()
      .select("#avatarCanvas")
      .fields({ node: true })
      .exec((res) => {
        const canvas = res && res[0] && res[0].node;
        if (!canvas) return this.setData({ error: "这台手机暂不支持裁剪头像" });
        canvas.width = SIDE;
        canvas.height = SIDE;
        const ctx = canvas.getContext("2d");
        const img = canvas.createImage();
        img.onload = () => {
          // 居中裁正方形（cropImage 已裁过时就是整张）
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
          if (url.length * 0.75 > TARGET) return this.setData({ error: "这张图压不到 30KB 以内，请换一张" });
          this.dataUrl = url;
          this.setData({ preview: url });
        };
        img.onerror = () => this.setData({ error: "这张图片读不出来，请换 JPG 或 PNG" });
        img.src = path;
      });
  },
  save() {
    if (!this.dataUrl) return;
    this.setData({ busy: true, error: "" });
    call("members.avatar.set", { image: this.dataUrl })
      .then(() => {
        this.dataUrl = "";
        this.setData({ busy: false, preview: "" });
        wx.showToast({ title: "头像已更新", icon: "success" });
        return this.load();
      })
      .catch((e) => this.setData({ busy: false, error: e.message }));
  },
  clear() {
    wx.showModal({
      title: "换回默认头像",
      content: "清除后显示名字首字，确定吗？",
      confirmColor: "#D97757",
      success: (m) =>
        m.confirm &&
        call("members.avatar.clear", {})
          .then(() => {
            this.setData({ current: "" });
            return this.load();
          })
          .catch((e) => this.setData({ error: e.message })),
    });
  },
});

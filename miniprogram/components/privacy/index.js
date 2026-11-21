// 隐私授权弹窗：用到选图、选头像、选文件、剪贴板前，微信会回调 onNeedPrivacyAuthorization。
// 多个页面都挂了这份组件时，必须在当前页显示时重新注册，否则会被仍存活的首页那份抢走，调用会静默挂起。
Component({
  data: { show: false },
  lifetimes: {
    attached() {
      this.bind();
    },
    detached() {
      this.unbind();
    },
  },
  pageLifetimes: {
    show() {
      this.bind();
    },
    hide() {
      this.unbind();
    },
  },
  methods: {
    bind() {
      if (!wx.onNeedPrivacyAuthorization) return;
      if (!this.listen) {
        this.listen = (resolve) => {
          this.resolve = resolve;
          this.setData({ show: true });
        };
      }
      if (wx.offNeedPrivacyAuthorization) wx.offNeedPrivacyAuthorization(this.listen);
      wx.onNeedPrivacyAuthorization(this.listen);
    },
    unbind() {
      if (wx.offNeedPrivacyAuthorization && this.listen) wx.offNeedPrivacyAuthorization(this.listen);
    },
    openContract() {
      wx.openPrivacyContract && wx.openPrivacyContract({});
    },
    agree() {
      this.setData({ show: false });
      // 按钮 open-type="agreePrivacyAuthorization" 已同意，这里通知微信继续
      this.resolve && this.resolve({ event: "agree", buttonId: "privacy-agree" });
      this.resolve = null;
    },
    disagree() {
      this.setData({ show: false });
      this.resolve && this.resolve({ event: "disagree" });
      this.resolve = null;
    },
  },
});

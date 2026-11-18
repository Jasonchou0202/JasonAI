// 隐私授权弹窗：用到选图、选文件、剪贴板前，微信会回调 onNeedPrivacyAuthorization
Component({
  data: { show: false },
  lifetimes: {
    attached() {
      if (!wx.onNeedPrivacyAuthorization) return;
      wx.onNeedPrivacyAuthorization((resolve) => {
        this.resolve = resolve;
        this.setData({ show: true });
      });
    },
  },
  methods: {
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

// 生意手账小程序入口：只初始化云开发，不缓存任何账本数据
let config;
try {
  config = require("./config.js");
} catch (e) {
  config = require("./config.example.js");
}
App({
  globalData: { config },
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({ title: "提示", content: "请升级微信后再打开", showCancel: false });
      return;
    }
    wx.cloud.init({ env: config.envId, traceUser: false });
    const updater = wx.getUpdateManager && wx.getUpdateManager();
    if (updater)
      updater.onUpdateReady(() =>
        wx.showModal({
          title: "有新版本",
          content: "新版本已经准备好，现在重启使用？",
          success: (r) => r.confirm && updater.applyUpdate(),
        }),
      );
  },
});

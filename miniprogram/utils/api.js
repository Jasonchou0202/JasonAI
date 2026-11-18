// 只经云函数 miniapp 读写；身份由微信平台注入，这里不传任何身份字段
const ERROR_TEXT = {
  MINIAPP_OFF: "小程序暂未开放",
  NO_ACCESS: "无权限",
};
function call(action, payload) {
  const { functionName } = getApp().globalData.config;
  return wx.cloud
    .callFunction({ name: functionName, data: { action, payload: payload || {} } })
    .then((res) => {
      const r = res && res.result;
      if (r && r.ok) return r.data;
      const code = (r && r.code) || "";
      const err = new Error((r && r.error) || ERROR_TEXT[code] || "云端操作未完成，请稍后重试");
      err.code = code;
      throw err;
    });
}
module.exports = { call };

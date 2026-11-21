// 一次性订阅「待办事项提醒」：须在用户点击的同步路径里调用 wx.requestSubscribeMessage，否则弹窗会被拒。
// 模板 ID 不是密钥，与云端默认一致；关着发送开关时仍可记额度。
const { call } = require("./api");
const TASK_TPL = "wsMYvp0ssfye_srTUreOx8zJy1SQqFlF20ZIGOVKC7o";

function offerTask() {
  return new Promise((resolve) => {
    if (!wx.requestSubscribeMessage) return resolve();
    wx.requestSubscribeMessage({
      tmplIds: [TASK_TPL],
      success: (res) => {
        const results = {};
        results[TASK_TPL] = res[TASK_TPL];
        call("miniapp.subscribe.record", { results })
          .then(() => resolve(), () => resolve());
      },
      fail: () => resolve(),
    });
  });
}

module.exports = { offerTask, TASK_TPL };

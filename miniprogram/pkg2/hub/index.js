// 第 2 批入口「更多」：按身份和开关列出报销、开票、图表、回收站、导出、成员、日志。
// 管理员才有的入口对成员不显示（云端同样会拒）。
const ui = require("../lib/ui");
Page({
  data: { loading: true, error: "", groups: [] },
  onShow() {
    ui.privacyShow();
    this.load();
  },
  onHide: ui.privacyHide,
  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },
  load(force) {
    return ui
      .me(force)
      .then((me) => {
        const item = (title, sub, url, show) => (show ? [{ title, sub, url }] : []);
        const groups = [
          {
            name: "账务",
            items: [
              ...item("报销记账", "十天合账、利润对照、本月明细", "/pkg2/expenses/index", me.expenses),
              ...item("开票", "待开票、已开票、客户开票资料", "/pkg2/invoices/index", me.invoices),
              ...item("经营图表", "新增客户、四色块、需求占比、矩阵、十天分成", "/pkg2/charts/index", true),
            ],
          },
          {
            name: "管理",
            items: [
              ...item("回收站", "销售、日程、报销的恢复和彻底删除", "/pkg2/trash/index", me.admin),
              ...item("导出 CSV", "销售明细发到聊天或文件传输助手", "/pkg2/export/index", me.admin),
              ...item("成员管理", "邀请、停用、恢复、固定颜色", "/pkg2/members/index", me.admin && me.members),
              ...item(me.admin ? "操作日志" : "我的操作记录", me.admin ? "所有人的写操作和被拒的尝试" : "只显示你自己的操作", "/pkg2/audit/index", me.audit),
            ],
          },
        ].filter((g) => g.items.length);
        this.setData({ loading: false, error: "", groups, admin: me.admin });
      })
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  open(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url });
  },
});

/**
 * 小程序共用的 domain 计算（scripts/build-miniapp.mjs 编译成 miniprogram/lib/domain.js）。
 * 只从 src/domain 和 src/miniapp 导出纯函数：两边算出来的数一致，小程序里不重写业务计算。
 */
export { money, moneyInput, parseYuan, totals } from "../domain/finance";
export { today, addDays, dateLabel } from "../domain/dates";
export { PROFIT_TARGET } from "../domain/profitTarget";
export { defaultFollowUp, inLunchBreak, scheduleText } from "../domain/entryHelpers";
export { dailyPendingTasks, sortTasksTodayFirst } from "../domain/tasks";
export { displayCustomerName } from "../domain/customers";
export * from "./charts";
export * from "./view";

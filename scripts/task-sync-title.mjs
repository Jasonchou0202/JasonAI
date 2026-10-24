// 用法：node scripts/task-sync-title.mjs < tasks.json  （输入 tasks.sync.list 的 tasks 数组）
// 逻辑与 src/domain/taskSyncTitle.ts 一致，由 tests/task-sync.test.ts 共同校验。
import { readFileSync } from "node:fs";
const MONEY = [
  /[（(【\[]?\s*费用\s*[:：]?\s*[¥￥]?\s*\d[\d,，.]*\s*(?:元|块)?\s*[）)】\]]?/g,
  /[¥￥]\s*\d[\d,，.]*\s*(?:元)?/g,
  /\d[\d,，.]*\s*元/g,
  /费用\s*[:：]?/g,
];
export function stripMoney(text) {
  let out = text;
  for (const re of MONEY) out = out.replace(re, " ");
  return out
    .replace(/[（(【\[]\s*[）)】\]]/g, " ")
    .replace(/\s*[,，;；、|]\s*(?=[,，;；、|]|$)/g, "")
    .replace(/^\s*[,，;；、|·:：-]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function taskSyncTitle(customerName, title) {
  const name = stripMoney(customerName.replace(/✅/g, "")).trim();
  const item = stripMoney(title) || "客户日程";
  return name ? `${name} · ${item}` : item;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const tasks = JSON.parse(readFileSync(0, "utf8"));
  for (const t of tasks) console.log(JSON.stringify({ id: t.id, title: taskSyncTitle(t.customer, t.title) }));
}

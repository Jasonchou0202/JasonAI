// 唯一实现：客户日程 → iPhone 提醒事项文本去金额、拼标题。
// 服务端（server/task-sync.ts）和 scripts/task-sync-title.mjs 都从这里引用。
const NUM = String.raw`\d+(?:[.,，]\d+)*`;
const UNIT = String.raw`(?:万元|万|千|[wWkK](?![A-Za-z])|块钱|块|元|美元|刀)`;
const KEYWORD = String.raw`(?:费用|报价|定金|订金|预算|尾款|价格|金额|总价|单价)`;
const MONEY = [
  // 关键词 + 数字：费用：1899元 / 定金3k / 预算 1.5万 / 报价¥99
  new RegExp(String.raw`${KEYWORD}\s*[:：]?\s*(?:约|共)?\s*[¥￥$]?\s*${NUM}\s*${UNIT}?`, "g"),
  // 货币符号 + 数字：¥1,299.00 / $20 / ￥3k
  new RegExp(String.raw`[¥￥$]\s*${NUM}\s*${UNIT}?`, "g"),
  // 数字 + 单位：500 元 / 1.5万 / 3k / 20块
  new RegExp(String.raw`${NUM}\s*${UNIT}`, "g"),
];
export function stripMoney(text) {
  let out = String(text ?? "");
  for (const re of MONEY) out = out.replace(re, " ");
  return out
    .replace(/[（(【\[]\s*[）)】\]]/g, " ")
    .replace(/\s*[,，;；、|]\s*(?=[,，;；、|]|$)/g, "")
    .replace(/^\s*[,，;；、|·:：-]+\s*/, "")
    .replace(/\s*[:：]\s*$/, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}
export function taskSyncTitle(customerName, title) {
  const name = stripMoney(String(customerName ?? "").replace(/✅/g, ""));
  const item = stripMoney(title) || "客户日程";
  return name ? `${name} · ${item}` : item;
}

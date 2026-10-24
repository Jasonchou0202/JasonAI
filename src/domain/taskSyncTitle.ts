/** 把客户日程转成 iPhone 提醒事项标题「客户名 · 事项」，并去掉金额片段。 */
const MONEY = [
  // 费用：1899元 / 费用 ¥1899 / 费用1899
  /[（(【\[]?\s*费用\s*[:：]?\s*[¥￥]?\s*\d[\d,，.]*\s*(?:元|块)?\s*[）)】\]]?/g,
  // ¥1899 / ￥1,899.00
  /[¥￥]\s*\d[\d,，.]*\s*(?:元)?/g,
  // 1899元 / 1899 元
  /\d[\d,，.]*\s*元/g,
  // 残留的“费用”字样
  /费用\s*[:：]?/g,
];
export function stripMoney(text: string): string {
  let out = text;
  for (const re of MONEY) out = out.replace(re, " ");
  return out
    .replace(/[（(【\[]\s*[）)】\]]/g, " ")
    .replace(/\s*[,，;；、|]\s*(?=[,，;；、|]|$)/g, "")
    .replace(/^\s*[,，;；、|·:：-]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function taskSyncTitle(customerName: string, title: string): string {
  const name = stripMoney(customerName.replace(/✅/g, "")).trim();
  const item = stripMoney(title) || "客户日程";
  return name ? `${name} · ${item}` : item;
}

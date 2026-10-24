// 唯一实现：客户日程 → iPhone 提醒事项文本去金额、拼标题。
// 服务端（server/task-sync.ts）和 scripts/task-sync-title.mjs 都从这里引用。
// 做法：只要命中金额写法，就把整段金额片段换成「（含金额，已隐藏）」。
export const MONEY_MASK = "（含金额，已隐藏）";
const D = "[0-9０-９]";
const CN = "[零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟]";
const CN_DIGIT = "[一二两三四五六七八九壹贰叁肆伍陆柒捌玖]";
// 允许千分位空格：￥1 899
const DIGNUM = String.raw`${D}+(?:(?:[.,，．]|\s(?=${D}{3}(?!${D})))${D}+)*`;
// 不带单位的中文数字：含千/百（两千八、八百八、壹仟捌佰）
const CN_BARE = `${CN_DIGIT}[千百仟佰]${CN}*`;
const CNNUM = `${CN}+`;
const NUM = `(?:${DIGNUM}|${CNNUM})`;
const CUR_PREFIX = String.raw`(?:HK\$|US\$|[¥￥$€£]|RMB|CNY|USD|HKD|EUR)`;
const CUR_UNIT = String.raw`(?:万元|千元|块钱|块|元|圆|美元|美金|港币|刀|RMB|CNY|USD|HKD|EUR|€)`;
// 千/万/k/w 量级，可带尾数（2千5）和币种（1.5万元）
const SCALE = String.raw`(?:[千万][0-9０-９一二三四五六七八九]*|[kKwW](?![A-Za-z]))`;
const PER_UNIT = "(?:月|年|季|周|天|次|人|个|台|份)";
const PER = String.raw`(?:\s*/\s*${PER_UNIT})`;
const APPROX = String.raw`(?:约|共|大约|大概|合计|共计|总共)`;
const KEYWORD = String.raw`(?:成交价|定金了|订金了|价钱|花了|交了|费用|报价|定金|订金|预算|尾款|首款|价格|金额|总价|单价|付款|收款|转账|打款|回款|到账|成交|收了|付了|收|付|[0-9一二三四五六七八九.]+折后?)`;
// 金额主体：数字 + 可选量级 + 可选币种 + 可选 /月 /年
const AMOUNT = `${NUM}\\s*${SCALE}?\\s*${CUR_UNIT}?${PER}?\\.?`;
const SEP = String.raw`\s*[:：]?\s*`;
const RULES = [
  // 关键词 + （约）+（币种）+ 数字：收了1899 / 付款 1899 / 收款：3000 / 八折后1200 / 定金3k
  new RegExp(`(?:[付交收]\\s*)?${KEYWORD}${SEP}${APPROX}?\\s*${CUR_PREFIX}?\\s*${AMOUNT}`, "gi"),
  // 币种前缀 + 数字：¥１８９９ / CNY 1899 / USD20 / €20 / HK$50
  new RegExp(`${APPROX}?\\s*${CUR_PREFIX}\\s*${AMOUNT}`, "gi"),
  // 数字 + 量级/币种（必须有其一）：1.5万 / 2千5 / 999元/年 / 1899RMB / 三千块 / 一千八百元
  new RegExp(`${APPROX}?\\s*${DIGNUM}\\s*(?:${SCALE}\\s*${CUR_UNIT}?|${CUR_UNIT})${PER}?`, "gi"),
  new RegExp(`${APPROX}?\\s*${CNNUM}\\s*${CUR_UNIT}${PER}?`, "gi"),
  // 数字/月、/年、/人、/次：499/月 / 199/人
  new RegExp(`${APPROX}?\\s*${DIGNUM}\\s*/\\s*${PER_UNIT}`, "gi"),
  // 不带单位的中文数字：两千八 / 八百八
  new RegExp(`${APPROX}?\\s*${CN_BARE}${PER}?`, "gi"),
];
export function stripMoney(text) {
  let out = String(text ?? "");
  for (const re of RULES) out = out.replace(re, `\u0000`);
  return out
    .replace(/[（(]\s*\u0000\s*[）)]/g, "\u0000")
    .replace(/\u0000(?:[\s+＋]*\u0000)*/g, MONEY_MASK)
    .replace(/\s*（含金额，已隐藏）\s*/g, MONEY_MASK)
    .replace(/[ \t]+/g, " ")
    .trim();
}
export function taskSyncTitle(customerName, title) {
  const name = stripMoney(String(customerName ?? "").replace(/✅/g, ""));
  const item = stripMoney(title) || "客户日程";
  return name ? `${name} · ${item}` : item;
}

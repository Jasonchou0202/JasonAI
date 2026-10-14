import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// Private inputs and report stay outside source control. Never print customer names.
const [beforePath, afterPath = beforePath] = process.argv.slice(2);
if (!beforePath) throw new Error("Usage: node scripts/verify-customer-upgrade.mjs <before.json> [after.json]");
const before = JSON.parse(await readFile(beforePath, "utf8"));
const after = JSON.parse(await readFile(afterPath, "utf8"));
assert.equal(after.version, 2);
await mkdir("artifacts", { recursive: true });
await build({ entryPoints: ["src/domain/customers.ts"], bundle: true, platform: "node", format: "cjs", outfile: "artifacts/verify-customers.cjs", logLevel: "silent" });
const { customerRanking, customerSuggestions } = createRequire(import.meta.url)(resolve("artifacts/verify-customers.cjs"));
const sum = rows => rows.reduce((t, s) => ({ count: t.count + 1, revenue: t.revenue + s.revenue, cost: t.cost + s.cost, profit: t.profit + s.revenue - s.cost }), { count: 0, revenue: 0, cost: 0, profit: 0 });
const visible = after.sales.filter(s => !s.deletedAt);
const oldById = new Map(before.sales.map(s => [s.id, s]));
const newById = new Map(after.sales.map(s => [s.id, s]));
for (const [id, sale] of oldById) assert.deepEqual(newById.get(id), sale, `Existing sale changed: ${id}`);
const additions = after.sales.filter(s => !oldById.has(s.id));
const months = [...new Set(visible.map(s => s.date.slice(0, 7)))].sort();
const periods = [{ type: "all" }, ...months.map(value => ({ type: "month", value }))];
const years = [...new Set(months.map(m => m.slice(0, 4)))];
for (const year of years) {
  periods.push({ type: "year", value: year });
  for (let q = 1; q <= 4; q++) periods.push({ type: "quarter", value: `${year}-Q${q}` });
  for (let h = 1; h <= 2; h++) periods.push({ type: "half", value: `${year}-H${h}` });
}
const reports = periods.map(period => {
  const rows = visible.filter(s => {
    if (period.type === "all") return true;
    if (period.type === "month") return s.date.startsWith(period.value);
    if (!s.date.startsWith(period.value.slice(0, 4))) return false;
    const month = Number(s.date.slice(5, 7));
    return period.type === "year" || (period.type === "quarter" ? Math.ceil(month / 3) : Math.ceil(month / 6)) === Number(period.value.at(-1));
  });
  const expected = sum(rows), ranking = customerRanking(after.customers, after.sales, period);
  assert.deepEqual(ranking.totals, expected);
  const actual = ranking.items.reduce((total, item) => {
    for (const key of Object.keys(total)) total[key] += item.totals[key];
    return total;
  }, { ...ranking.unassigned });
  assert.deepEqual(actual, expected);
  ranking.items.forEach((item, i) => {
    assert.equal(item.rank, i + 1);
    if (i) assert.ok(ranking.items[i - 1].totals.profit >= item.totals.profit);
  });
  return { period, ...expected, customers: ranking.items.length };
});
const suggestions = customerSuggestions(after.customers, after.sales, after.tasks);
const report = { checkedAt: new Date().toISOString(), existingSalesUnchanged: oldById.size, newSalesSinceBackup: additions.length, totals: sum(visible), periodsChecked: reports.length, remainingIpGroups: suggestions.filter(s => s.reason === "ip_or_symbol").length, remainingCaseGroups: suggestions.filter(s => s.reason === "case").length, periods: reports };
await mkdir("private-data", { recursive: true });
await writeFile("private-data/customer-upgrade-verification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, periods: undefined }, null, 2));

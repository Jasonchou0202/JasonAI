// 核对 sales / reminders / sales-stats 云函数包和基线逐字节一致（内容函数的改动不许波及销售函数）。
// 用法：先 npm run build:server，再 node scripts/verify-sales-bundles.mjs
// --update 只能用于销售代码（sales / reminders / sales-stats）的改动，且必须第二大脑审查通过并经章鱼哥本人确认；
// 其他改动导致核对失败时不许用 --update 绕过。
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const FIXTURE = "tests/fixtures/sales-bundles.sha256.json";
const FILES = [
  "cloudfunctions/sales/index.js",
  "cloudfunctions/sales/package.json",
  "cloudfunctions/reminders/index.js",
  "cloudfunctions/reminders/package.json",
  "cloudfunctions/sales-stats/index.js",
  "cloudfunctions/sales-stats/package.json",
];
const actual = {};
for (const f of FILES)
  actual[f] = createHash("sha256")
    .update(await readFile(f))
    .digest("hex");
if (process.argv.includes("--update")) {
  await writeFile(FIXTURE, JSON.stringify(actual, null, 2) + "\n");
  console.log("已更新销售函数包基线");
} else {
  const expected = JSON.parse(await readFile(FIXTURE, "utf8"));
  const bad = FILES.filter((f) => expected[f] !== actual[f]);
  if (bad.length) {
    console.error("✗ 销售函数包和基线不一致：" + bad.join("、"));
    process.exit(1);
  }
  console.log("✓ 销售函数包和基线逐字节一致");
}

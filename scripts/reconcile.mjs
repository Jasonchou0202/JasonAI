import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
const file = process.argv[2];
if (!file)
  throw new Error("用法：node scripts/reconcile.mjs <私有销售表.xlsx>");
await mkdir("artifacts", { recursive: true });
await mkdir("private-data", { recursive: true });
await build({
  entryPoints: ["src/domain/import.ts"],
  outfile: "artifacts/reconcile-domain.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});
const { parseGrid } = createRequire(import.meta.url)(
  resolve("artifacts/reconcile-domain.cjs"),
);
const bytes = await readFile(file),
  book = XLSX.read(bytes, {
    type: "buffer",
    cellDates: false,
    codepage: 65001,
  });
const grid = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
  header: 1,
  defval: "",
  raw: true,
});
const preview = parseGrid(
  grid,
  file,
  createHash("sha256").update(bytes).digest("hex"),
);
const report = {
  file,
  digest: preview.digest,
  sheets: book.SheetNames,
  columns: grid[0],
  sourceRows: grid
    .slice(1)
    .filter((row) => row.some((v) => String(v ?? "").trim())).length,
  validRows: preview.rows.length,
  issues: preview.issues,
  totals: preview.totals,
  months: preview.months,
};
await writeFile(
  "private-data/reconciliation.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
if (report.issues.some((i) => i.kind === "error")) process.exitCode = 1;

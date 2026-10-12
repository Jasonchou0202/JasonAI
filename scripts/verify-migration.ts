import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { parseGrid } from "../src/domain/import";
import { totals, monthlyTotals } from "../src/domain/finance";
import { execute } from "../server/service";
import { MemoryStore } from "../server/memory-store";
import type { Backup, Sale } from "../src/domain/model";
async function verify() {
  const file = process.argv[2];
  if (!file) throw new Error("请指定本机私有销售表文件");
  const bytes = await readFile(file),
    book = XLSX.read(bytes, { cellDates: false });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(
    book.Sheets[book.SheetNames[0]],
    { header: 1, raw: true, defval: "" },
  );
  const hash = async (s: string) =>
    createHash("sha256").update(s).digest("hex");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const preview = parseGrid(grid, file, digest);
  if (preview.issues.some((i) => i.kind === "error"))
    throw new Error("预检未通过，不能模拟导入");
  const store = new MemoryStore(),
    target = new MemoryStore();
  const ctx = { uid: "migration-test", ownerUid: "migration-test", hash };
  async function finish(action: string, payload: unknown, s = store) {
    let r: any;
    do {
      r = await execute(s, ctx, action, payload);
    } while (r.done === false);
  }
  const payload = {
    rows: preview.rows,
    digest,
    fileName: "private-source.xlsx",
  };
  await finish("import.commit", payload);
  await finish("import.commit", payload);
  const exported = (await execute(store, ctx, "export")) as Sale[];
  const backup = (await execute(store, ctx, "backup")) as Backup;
  await finish("backup.restore", { backup }, target);
  const restored = (await execute(target, ctx, "export")) as Sale[];
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  if (
    !same(totals(exported), preview.totals) ||
    !same(monthlyTotals(exported), preview.months) ||
    !same(totals(restored), preview.totals)
  )
    throw new Error("迁移模拟核对不一致");
  await writeFile(
    "private-data/migration-validation.json",
    JSON.stringify(
      {
        mode: "local-memory-simulation",
        digest,
        rows: exported.length,
        duplicateImportRows: exported.length,
        restoredRows: restored.length,
        totals: totals(exported),
        months: monthlyTotals(exported),
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      mode: "本机模拟，尚未写入真实云端",
      rows: exported.length,
      repeatedImportRows: exported.length,
      restoredRows: restored.length,
      totals: totals(exported),
      monthlyReconciliation: "passed",
    }),
  );
}
verify().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

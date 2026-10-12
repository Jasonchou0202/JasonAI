import { parseGrid, exportCsv, validateBackup } from "../domain/import";
import { sha256 } from "./demo";
import type { Sale } from "../domain/model";
export function download(
  name: string,
  body: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
export function downloadCsv(rows: Sale[]) {
  download(
    `销售明细-${new Date().toISOString().slice(0, 10)}.csv`,
    exportCsv(rows),
    "text/csv;charset=utf-8",
  );
}
export async function readImport(file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("请选择10MB以内的表格");
  const bytes = await file.arrayBuffer();
  const XLSX = await import("xlsx");
  const book = XLSX.read(bytes, {
    type: "array",
    cellDates: false,
    codepage: 65001,
  });
  const sheet = book.Sheets[book.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  return parseGrid(grid, file.name, await sha256(bytes));
}
export async function readBackup(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error("备份文件过大");
  return validateBackup(JSON.parse(await file.text()));
}

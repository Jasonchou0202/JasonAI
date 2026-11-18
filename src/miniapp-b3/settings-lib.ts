/**
 * 小程序「账本设置」分包用的库（第 3 批）：构建成 miniprogram/pkg-settings/lib/settings-lib.js。
 * - 读 Excel：和网页 src/lib/files.ts readImport 同一套参数，同一个 parseGrid，同一个文件指纹（SHA-256），
 *   所以同一个文件在网页和小程序导入，是同一批次，不会重复导入。
 * - 备份：网页下载的 .json 备份和小程序发到聊天的 .json 是同一种格式；上传前 gzip 压缩、base64。
 */
import * as XLSX from "xlsx";
import { gunzipSync, gzipSync } from "fflate";
import { parseGrid, validateBackup } from "../domain/import";
import type { Backup, ImportPreview } from "../domain/model";
import { sha256Hex, utf8, utf8Decode } from "./sha256";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;
/** 超过这个大小就走 wx.cloud.CDN（官方建议 100KB 以上） */
export const INLINE_MAX = 90 * 1024;

export function readExcel(bytes: ArrayBuffer, fileName: string): ImportPreview {
  if (bytes.byteLength > IMPORT_MAX_BYTES) throw new Error("请选择10MB以内的表格");
  if (!/\.(xlsx|xls|csv)$/i.test(fileName)) throw new Error("请选择 Excel 表格（.xlsx / .xls / .csv）");
  const book = XLSX.read(bytes, { type: "array", cellDates: false, codepage: 65001 });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error("表格里没有工作表");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  return parseGrid(grid, fileName, sha256Hex(new Uint8Array(bytes)));
}
export function readBackupText(text: string): Backup {
  if (text.length > BACKUP_MAX_BYTES) throw new Error("备份文件过大");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("这不是生意手账的备份文件");
  }
  return validateBackup(parsed);
}
export function backupFileName(exportedAt: string) {
  return `章鱼哥账本备份-${String(exportedAt).slice(0, 10)}.json`;
}
/** 小程序发出的备份：云端 gzip+base64 → 还原成和网页下载一样的 JSON 文本 */
export function gunzipBase64(b64: string): string {
  return utf8Decode(gunzipSync(base64ToBytes(b64)));
}
export function gzipBase64(text: string): string {
  return bytesToBase64(gzipSync(utf8(text), { level: 9 }));
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function bytesToBase64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < b.length ? B64[n & 63] : "=");
  }
  return out;
}
export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
/** 预览给页面用的摘要（金额是分） */
export function previewSummary(p: ImportPreview) {
  const errors = p.issues.filter((i) => i.kind === "error");
  return {
    fileName: p.fileName,
    rows: p.rows.length,
    errors: errors.length,
    warnings: p.issues.length - errors.length,
    issues: p.issues.slice(0, 20).map((i) => `第 ${i.row} 行：${i.message}`),
    duplicates: p.duplicateRows.length,
    totals: p.totals,
    months: p.months.slice(-12),
  };
}

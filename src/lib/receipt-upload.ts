import type { Api } from "../domain/model";
import type { ExpenseReceipt, ReceiptKind, ReceiptMime } from "../domain/expenses";
import { RECEIPT_MAX_BYTES, receiptMime } from "../domain/expenses";

/** 与云函数中转上限一致：直传失败时，4MB 以内的文件改经云函数中转 */
export const RELAY_MAX_BYTES = 4 * 1024 * 1024;

interface Ticket {
  url: string;
  headers: Record<string, string>;
  fileID: string;
}

async function base64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 选文件时先在本机挡一遍：类型和大小 */
export function checkReceiptFile(file: File): string | null {
  if (!receiptMime(file.name, file.type)) return `「${file.name}」不是 PDF 或图片`;
  if (file.size > RECEIPT_MAX_BYTES) return `「${file.name}」超过 10MB`;
  if (file.size <= 0) return `「${file.name}」是空文件`;
  return null;
}

/**
 * 上传一批凭证：先向云函数要直传签名（只对指定路径有效），PUT 到云存储；
 * 拿不到签名或直传失败时，4MB 以内的改走云函数中转。返回可存进记录的凭证列表。
 */
export async function uploadReceipts(
  api: Api,
  items: { file: File; kind: ReceiptKind }[],
  onProgress?: (done: number) => void,
): Promise<ExpenseReceipt[]> {
  if (!items.length) return [];
  const prepared = await api.call<{ items: { type: ReceiptMime; ticket: Ticket | null }[] }>("expenses.receipts.prepare", {
    files: items.map(({ file }) => ({ name: file.name, type: file.type, size: file.size })),
  });
  const out: ExpenseReceipt[] = [];
  for (let i = 0; i < items.length; i++) {
    const { file, kind } = items[i];
    const prep = prepared.items[i];
    let fileID = "";
    let type: ReceiptMime = prep?.type;
    let size = file.size;
    if (prep?.ticket) {
      try {
        const res = await fetch(prep.ticket.url, { method: "PUT", headers: prep.ticket.headers, body: file });
        if (res.ok) fileID = prep.ticket.fileID;
      } catch {
        // 网络或跨域失败：下面改走中转
      }
    }
    if (!fileID) {
      if (file.size > RELAY_MAX_BYTES) throw new Error(`「${file.name}」上传没成功，超过 4MB 的文件请压缩后再试`);
      const r = await api.call<{ fileID: string; type: ReceiptMime; size: number }>("expenses.receipts.upload", {
        name: file.name,
        data: await base64(file),
      });
      fileID = r.fileID;
      type = r.type;
      size = r.size;
    }
    out.push({ fileID, name: file.name.slice(0, 120), type, size, kind });
    onProgress?.(i + 1);
  }
  return out;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

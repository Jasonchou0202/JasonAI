/**
 * 报销凭证（EXPENSE_RECEIPTS_ENABLED=1，要 EXPENSES_ENABLED 也开着、并且有云存储）。
 * - 云存储权限保持「仅管理员可读写」：网页不直接拿存储权限。
 * - 上传两条路：
 *   1. 直传（大文件，≤10MB）：云函数用服务端权限给一个只对指定路径有效的上传签名，网页 PUT 到这个地址；
 *   2. 中转（≤4MB，直传失败时兜底）：网页把文件 base64 交给云函数，云函数查文件头后再写云存储。
 * - 路径固定 expenses/<上传人 uid>/<随机名>.<扩展名>，保存记录时云函数核对上传人；读取一律经云函数换 2 小时临时链接。
 */
import { MIME_EXT, RECEIPT_MAX_BYTES, type ReceiptMime } from "../src/domain/expenses";

export const RECEIPT_RELAY_MAX_BYTES = 4 * 1024 * 1024;
export const RECEIPT_URL_TTL_S = 2 * 3600;

export interface UploadTicket {
  /** PUT 地址 */
  url: string;
  /** 直传时要带上的请求头（签名、临时令牌） */
  headers: Record<string, string>;
  fileID: string;
}

export interface ReceiptStorage {
  /** 只对 cloudPath 有效的直传签名；拿不到返回 null（网页改走中转） */
  ticket(cloudPath: string): Promise<UploadTicket | null>;
  upload(cloudPath: string, bytes: Uint8Array): Promise<string>;
  remove(fileIDs: string[]): Promise<void>;
  tempUrls(fileIDs: string[]): Promise<Map<string, string>>;
}

export class ReceiptError extends Error {
  readonly code = "RECEIPT_INVALID";
}

/** 按文件头判断真实类型（中转上传时用；HEIC/HEIF 看 ftyp 品牌） */
export function sniffReceipt(b: Uint8Array): ReceiptMime | null {
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return "image/png";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1", "heif"].includes(brand)) return "image/heif";
  }
  return null;
}

/** 生成存储路径：expenses/<uid>/<日期>-<随机>.<扩展名>；uid 由云函数按登录身份给，不收网页传的 */
export function receiptPath(uid: string, mime: ReceiptMime, random: string, day: string): string {
  if (!/^[\w-]{1,128}$/.test(uid)) throw new ReceiptError("上传人无效");
  const safe = random.replace(/[^\w]/g, "").slice(0, 32) || "file";
  return `expenses/${uid}/${day.replace(/-/g, "")}-${safe}.${MIME_EXT[mime]}`;
}

/** base64（可带 data: 前缀）→ 字节；超过中转上限直接挡掉 */
export function decodeReceipt(input: unknown): Uint8Array {
  if (typeof input !== "string" || !input) throw new ReceiptError("凭证文件无效");
  const raw = input.replace(/^data:[\w/+.-]+;base64,/, "");
  if (raw.length > Math.ceil(RECEIPT_RELAY_MAX_BYTES / 3) * 4 + 4)
    throw new ReceiptError("文件超过 4MB，请稍后重试直传或压缩后再传");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new ReceiptError("凭证文件无效");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (!bytes.length || bytes.length > Math.min(RECEIPT_RELAY_MAX_BYTES, RECEIPT_MAX_BYTES))
    throw new ReceiptError("文件超过 4MB，请稍后重试直传或压缩后再传");
  return bytes;
}

/** 内存版（测试和演示用）：不给直传签名，网页走中转；临时链接是 data: 地址 */
export class MemoryReceiptStorage implements ReceiptStorage {
  files = new Map<string, { bytes: Uint8Array; type: string }>();
  removed: string[] = [];
  tickets: string[] = [];
  constructor(private allowTicket = false) {}
  async ticket(cloudPath: string) {
    if (!this.allowTicket) return null;
    this.tickets.push(cloudPath);
    return { url: `https://upload.example.invalid/${cloudPath}`, headers: { authorization: "test" }, fileID: "cloud://demo/" + cloudPath };
  }
  async upload(cloudPath: string, bytes: Uint8Array) {
    const id = "cloud://demo/" + cloudPath;
    this.files.set(id, { bytes, type: sniffReceipt(bytes) ?? "application/octet-stream" });
    return id;
  }
  async remove(fileIDs: string[]) {
    for (const id of fileIDs) {
      this.files.delete(id);
      this.removed.push(id);
    }
  }
  async tempUrls(fileIDs: string[]) {
    const out = new Map<string, string>();
    for (const id of fileIDs) {
      const f = this.files.get(id);
      if (!f) continue;
      let bin = "";
      for (const x of f.bytes) bin += String.fromCharCode(x);
      out.set(id, `data:${f.type};base64,` + btoa(bin));
    }
    return out;
  }
}

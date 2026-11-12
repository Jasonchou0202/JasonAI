/**
 * 成员头像：云端再查一遍（网页已经裁成 128×128 并压到 30KB 内）。
 * - 解码后不超过 40KB；文件头必须是 WebP 或 JPEG；尺寸不超过 256×256。
 * - 网页不直接读写云存储：上传、删除、换临时链接都经 sales 云函数（服务端权限）。
 */
export const AVATAR_MAX_BYTES = 40 * 1024;
export const AVATAR_MAX_SIDE = 256;
export const AVATAR_URL_TTL_S = 2 * 3600;

export interface AvatarStorage {
  /** 上传到云存储，返回 fileID */
  upload(cloudPath: string, bytes: Uint8Array): Promise<string>;
  remove(fileID: string): Promise<void>;
  /** fileID → 临时链接（有效 2 小时） */
  tempUrls(fileIDs: string[]): Promise<Map<string, string>>;
}
export interface AvatarRef {
  fileID: string;
  hash: string;
  bytes: number;
  type: "webp" | "jpeg";
  updatedAt: string;
  updatedBy: string;
}
export class AvatarError extends Error {
  readonly code = "AVATAR_INVALID";
}

function u16be(b: Uint8Array, i: number) {
  return (b[i] << 8) | b[i + 1];
}
function u16le(b: Uint8Array, i: number) {
  return b[i] | (b[i + 1] << 8);
}
function u24le(b: Uint8Array, i: number) {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}
/** 读 JPEG / WebP 的类型和尺寸；不是这两种（或头坏了）返回 null */
export function imageInfo(b: Uint8Array): { type: "webp" | "jpeg"; width: number; height: number } | null {
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) return { type: "jpeg", height: u16be(b, i + 5), width: u16be(b, i + 7) };
      i += 2 + len;
    }
    return null;
  }
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)
      return { type: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { type: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}
/** base64（可带 data: 前缀）→ 校验后的字节 */
export function decodeAvatar(input: unknown): { bytes: Uint8Array; type: "webp" | "jpeg" } {
  if (typeof input !== "string" || !input) throw new AvatarError("头像图片无效");
  const raw = input.replace(/^data:image\/(webp|jpeg);base64,/, "");
  // 40KB 的 base64 约 54.6K 字符，先按长度挡掉超大请求
  if (raw.length > Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw))
    throw new AvatarError("头像图片太大或格式无效（上限 40KB）");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length > AVATAR_MAX_BYTES) throw new AvatarError("头像图片太大（上限 40KB）");
  const info = imageInfo(bytes);
  if (!info) throw new AvatarError("头像只接受 WebP 或 JPEG");
  if (!info.width || !info.height || info.width > AVATAR_MAX_SIDE || info.height > AVATAR_MAX_SIDE)
    throw new AvatarError("头像尺寸不能超过 256×256");
  return { bytes, type: info.type };
}
/** 内存版云存储（测试和演示用；演示里临时链接就是 data: 地址） */
export class MemoryAvatarStorage implements AvatarStorage {
  files = new Map<string, Uint8Array>();
  removed: string[] = [];
  failRemove = false;
  async upload(cloudPath: string, bytes: Uint8Array) {
    const id = "cloud://demo/" + cloudPath;
    this.files.set(id, bytes);
    return id;
  }
  async remove(fileID: string) {
    if (this.failRemove) throw new Error("remove failed");
    this.files.delete(fileID);
    this.removed.push(fileID);
  }
  async tempUrls(fileIDs: string[]) {
    const out = new Map<string, string>();
    for (const id of fileIDs) {
      const b = this.files.get(id);
      if (!b) continue;
      const type = imageInfo(b)?.type ?? "jpeg";
      let bin = "";
      for (const x of b) bin += String.fromCharCode(x);
      out.set(id, `data:image/${type};base64,` + btoa(bin));
    }
    return out;
  }
}

/**
 * 小程序示例数据用的运行环境补丁：网页示例账本（src/lib/demo.ts）用到的浏览器接口，在小程序里用内存实现。
 * 只在「看示例数据」分包里加载；全部在内存里，不写本机缓存（方案：本机不缓存账本数据）。
 */
import { sha256Bytes, utf8 } from "./sha256";

type G = Record<string, any>;
const g = globalThis as G;
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
export function installShims() {
  if (!g.localStorage) g.localStorage = new MemStorage();
  if (!g.sessionStorage) g.sessionStorage = new MemStorage();
  if (!g.location) g.location = { search: "", href: "", pathname: "/" };
  if (!g.URLSearchParams)
    g.URLSearchParams = class {
      private m = new Map<string, string>();
      constructor(q = "") {
        for (const part of String(q).replace(/^\?/, "").split("&")) {
          if (!part) continue;
          const [k, v = ""] = part.split("=");
          this.m.set(decodeURIComponent(k), decodeURIComponent(v));
        }
      }
      get(k: string) {
        return this.m.has(k) ? this.m.get(k)! : null;
      }
    };
  if (!g.navigator) g.navigator = { onLine: true };
  if (g.navigator.onLine === undefined) g.navigator.onLine = true;
  if (!g.TextEncoder)
    g.TextEncoder = class {
      encode(s: string) {
        return utf8(s);
      }
    };
  const random = (b: Uint8Array) => {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  };
  if (!g.crypto) g.crypto = {};
  if (!g.crypto.getRandomValues) g.crypto.getRandomValues = random;
  if (!g.crypto.randomUUID)
    g.crypto.randomUUID = () => {
      const b = random(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    };
  if (!g.crypto.subtle)
    g.crypto.subtle = {
      async digest(_alg: string, data: ArrayBuffer | Uint8Array) {
        const out = sha256Bytes(data instanceof Uint8Array ? data : new Uint8Array(data));
        return out.buffer;
      },
    };
  if (!g.structuredClone) g.structuredClone = (v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  if (!g.atob) g.atob = (s: string) => s;
  if (!g.btoa) g.btoa = (s: string) => s;
}
installShims();

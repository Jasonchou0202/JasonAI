/**
 * 小程序第 2 批打包时用 esbuild inject 把 domain 里的全局 Intl 换成这里的。
 * 部分安卓微信 JS 引擎的 Intl 不全（不认 timeZone / sv-SE），domain 的 today()、money() 会算错或报错。
 * 原生可用就用原生；否则兜底：sv-SE + Asia/Shanghai 的日期（北京时间 = UTC+8，无夏令时）、zh-CN 千分位整数。
 * （第 1 批另有一份同样用途的 safe-intl，合并时二选一即可）
 */
type DateOpts = { timeZone?: string; year?: string; month?: string; day?: string; hour?: string; minute?: string };
const pad = (n: number) => String(n).padStart(2, "0");
class FallbackDateTimeFormat {
  constructor(_locale: string, private opts: DateOpts = {}) {}
  format(date: Date | number = new Date()) {
    const t = typeof date === "number" ? date : date.getTime();
    const d = new Date(t + 8 * 3600_000);
    const day = [this.opts.year ? String(d.getUTCFullYear()) : "", this.opts.month ? pad(d.getUTCMonth() + 1) : "", this.opts.day ? pad(d.getUTCDate()) : ""].filter(Boolean);
    const time = [this.opts.hour ? pad(d.getUTCHours()) : "", this.opts.minute ? pad(d.getUTCMinutes()) : ""].filter(Boolean);
    return [day.join("-"), time.join(":")].filter(Boolean).join(" ");
  }
}
class FallbackNumberFormat {
  constructor(_locale: string, _opts: unknown = {}) {}
  format(value: number) {
    const n = Math.round(Math.abs(value));
    const s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return value < 0 && n ? "-" + s : s;
  }
}
function nativeOk(): boolean {
  try {
    const g = (globalThis as { Intl?: typeof Intl }).Intl;
    if (!g) return false;
    const d = new g.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.UTC(2026, 0, 1, 20)));
    const n = new g.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(12345);
    return d === "2026-01-02" && n === "12,345";
  } catch {
    return false;
  }
}
const OK = nativeOk();
const native = (globalThis as { Intl?: typeof Intl }).Intl;
export const SafeIntl = {
  DateTimeFormat: function (locale: string, opts?: DateOpts) {
    return OK && native ? new native.DateTimeFormat(locale, opts as Intl.DateTimeFormatOptions) : new FallbackDateTimeFormat(locale, opts);
  },
  NumberFormat: function (locale: string, opts?: Intl.NumberFormatOptions) {
    return OK && native ? new native.NumberFormat(locale, opts) : new FallbackNumberFormat(locale, opts);
  },
} as unknown as typeof Intl;
export { FallbackDateTimeFormat, FallbackNumberFormat };

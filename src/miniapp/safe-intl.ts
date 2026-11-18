/**
 * 小程序打包时用 esbuild inject 把 domain 代码里的全局 Intl 换成这里的 Intl。
 * 原因：部分安卓微信的 JS 引擎 Intl 不全（不认 timeZone 或 sv-SE），
 * domain 里的 today()、money() 就会算错日期或报错。原生能用就用原生，不能用才走兜底。
 * 兜底只覆盖 domain 实际用到的两种：sv-SE + Asia/Shanghai 的日期，zh-CN 的千分位整数。
 * 中国没有夏令时，北京时间 = UTC+8。
 */
type DateOpts = { timeZone?: string; year?: string; month?: string; day?: string; hour?: string; minute?: string; hourCycle?: string; hour12?: boolean };
const pad = (n: number) => String(n).padStart(2, "0");

export class FallbackDateTimeFormat {
  constructor(
    private locale: string,
    private opts: DateOpts = {},
  ) {}
  format(date: Date | number = new Date()) {
    const t = typeof date === "number" ? date : date.getTime();
    const d = new Date(t + 8 * 3600_000);
    const parts: string[] = [];
    const day = [
      this.opts.year ? String(d.getUTCFullYear()) : "",
      this.opts.month ? pad(d.getUTCMonth() + 1) : "",
      this.opts.day ? pad(d.getUTCDate()) : "",
    ].filter(Boolean);
    if (day.length) parts.push(day.join("-"));
    const time = [this.opts.hour ? pad(d.getUTCHours()) : "", this.opts.minute ? pad(d.getUTCMinutes()) : ""].filter(Boolean);
    if (time.length) parts.push(time.join(":"));
    return parts.join(" ");
  }
}
export class FallbackNumberFormat {
  constructor(
    private locale: string,
    private opts: { maximumFractionDigits?: number } = {},
  ) {}
  format(value: number) {
    const digits = this.opts.maximumFractionDigits ?? 3;
    const fixed = Math.abs(value).toFixed(Math.min(digits, 20));
    const [int, frac = ""] = fixed.split(".");
    const trimmed = frac.replace(/0+$/, "");
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
    return sign + grouped + (trimmed ? "." + trimmed : "");
  }
}

/** 原生 Intl 能正确算出北京时间和千分位才用原生 */
export function nativeIntlWorks(native: typeof globalThis.Intl | undefined): boolean {
  try {
    if (!native) return false;
    const probe = Date.UTC(2026, 0, 1, 20, 0, 0); // 北京时间 2026-01-02 04:00
    const day = new native.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(probe);
    const num = new native.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(1234567);
    return day === "2026-01-02" && num === "1,234,567";
  } catch {
    return false;
  }
}

// 小程序老基础库可能没有 globalThis，直接取全局 Intl
const native: typeof globalThis.Intl | undefined = typeof Intl !== "undefined" ? Intl : undefined;
export const SafeIntl = nativeIntlWorks(native)
  ? native!
  : ({ DateTimeFormat: FallbackDateTimeFormat, NumberFormat: FallbackNumberFormat } as unknown as typeof globalThis.Intl);
export { SafeIntl as Intl };

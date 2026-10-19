import { ContentMemoryStore } from "../../server/content/memory-store";
import { contentOnly } from "../../server/content/guard";
import { executeContent } from "../../server/content/service";
import {
  contentAddDays,
  contentToday,
  type ContentDaily,
} from "../domain/content";
import type { ContentApi } from "./content-api";
async function sha256(value: string): Promise<string> {
  const buffer = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const KEY = "zhangyuge-content-demo-v1";
/** 演示模式：虚构的获客数字，只存本机，不连云端 */
export function createContentDemo(): ContentApi {
  const raw = new ContentMemoryStore();
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) raw.data = JSON.parse(saved);
    else seed();
  } catch {
    seed();
  }
  function seed() {
    const t = contentToday();
    const pattern = [
      [3, 1, 2, 0],
      [5, 0, 1, 0],
      [2, 2, 0, 1],
      [4, 1, 1, 0],
      [1, 0, 0, 0],
      [6, 2, 1, 1],
    ];
    raw.data = { content_daily: {} };
    // 今天留空，演示「还没录」的状态
    for (let d = 1; d <= 6; d++) {
      const [a, b, c, x] = pattern[d - 1];
      const date = contentAddDays(t, -d);
      const at = `${date}T13:30:00.000Z`;
      const row: ContentDaily = {
        date,
        wechat_adds: a + b + c + x,
        leads: { 抖音: a, 视频号: b, 公众号: c, 小红书: x },
        note: "虚构演示数字",
        revision: 1,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        lastMutation: "demo-seed-" + d,
      };
      raw.data.content_daily[date] = row;
    }
  }
  const store = contentOnly(raw);
  return {
    async call<T>(action: string, payload: unknown = {}) {
      if (!navigator.onLine)
        throw new Error("网络已断开，草稿已保留，请联网后重试");
      const result = await executeContent(
        store,
        { uid: "demo", ownerUid: "demo", hash: sha256 },
        action,
        payload,
      );
      localStorage.setItem(KEY, JSON.stringify(raw.data));
      return result as T;
    },
  };
}

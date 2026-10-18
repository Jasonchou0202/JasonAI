import { Component, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

// 新版本发布后，旧页面按需加载的文件可能已被删除（404）。
// 这里兜住加载失败，避免整页白屏，并提示刷新拿到新版本。
const CHUNK_ERROR =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;
const RELOAD_KEY = "zhangyuge-chunk-reload-at";
// 两次自动刷新之间至少隔 1 分钟，防止反复刷新
const RELOAD_GAP = 60_000;

export function isChunkError(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return CHUNK_ERROR.test(text);
}

// vite:preloadError：按需文件拿不到时自动刷新一次；若刚刷新过仍失败，交给下面的兜底页
export function installPreloadRecovery(canReload: () => boolean = () => true) {
  const onError = (event: Event) => {
    if (!navigator.onLine || !canReload()) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    } catch {
      return;
    }
    const now = Date.now();
    if (last && now - last < RELOAD_GAP) return;
    try {
      sessionStorage.setItem(RELOAD_KEY, String(now));
    } catch {
      return;
    }
    event.preventDefault();
    location.reload();
  };
  window.addEventListener("vite:preloadError", onError);
  return () => window.removeEventListener("vite:preloadError", onError);
}

export class UpdateBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    const update = isChunkError(this.state.error);
    return (
      <section className="update-fallback" role="alert">
        <h1>{update ? "页面有更新" : "页面出了点问题"}</h1>
        <p>
          {update
            ? "账本刚发布了新版本，这一页需要刷新后才能打开。"
            : "这一页暂时打不开，刷新后再试一次。"}
          已保存的账目和草稿都在，不会丢失。
        </p>
        <button
          type="button"
          className="button primary"
          onClick={() => location.reload()}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {update ? "页面有更新，点此刷新" : "页面出了点问题，点此刷新"}
        </button>
      </section>
    );
  }
}

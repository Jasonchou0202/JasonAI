import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Plus,
  ReceiptText,
  Settings as SettingsIcon,
  LogOut,
  Github,
  ArrowRight,
  ShieldCheck,
  WifiOff,
  CheckCircle2,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { Dashboard } from "./components/Dashboard";
import { SaleForm } from "./components/SaleForm";
import { Details } from "./components/Details";
import { Settings } from "./components/Settings";
import { Brand, ErrorNote, Loading, message } from "./components/ui";
import type { Filters, Sale } from "./domain/model";
import { cloudApi, configured, session, login, logout } from "./lib/cloud";
import { createDemo } from "./lib/demo";
import { routeParams, readFilters, filterQuery } from "./lib/routes";
type Page = "dashboard" | "entry" | "details" | "settings";
function readRoute(): Page {
  const p = location.hash.replace("#/", "").split("?")[0];
  return ["entry", "details", "settings"].includes(p)
    ? (p as Page)
    : "dashboard";
}
export default function App() {
  const [mode, setMode] = useState<"loading" | "login" | "cloud" | "demo">(
    "loading",
  );
  const [page, setPage] = useState<Page>(readRoute);
  const [edit, setEdit] = useState<Sale>();
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [editError, setEditError] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [loginBusy, setLoginBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    session()
      .then(async (ok) => {
        if (ok) {
          await cloudApi.call("session");
          if (alive) setMode("cloud");
        } else if (alive)
          setMode(
            sessionStorage.getItem("zhangyuge-demo") === "true"
              ? "demo"
              : "login",
          );
      })
      .catch((e) => {
        if (alive) {
          setError(message(e));
          setMode("login");
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const route = () => {
      setPage(readRoute());
      setFilters(readFilters());
    };
    const net = () => setOnline(navigator.onLine);
    window.addEventListener("hashchange", route);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener("hashchange", route);
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, mode]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const api = useMemo(
    () => (mode === "demo" ? createDemo() : cloudApi),
    [mode],
  );
  const editId = page === "entry" ? routeParams().get("id") : null;
  useEffect(() => {
    if (!editId || !["cloud", "demo"].includes(mode)) {
      setEdit(undefined);
      return;
    }
    let active = true;
    setEditError("");
    api
      .call<Sale>("sales.get", { id: editId })
      .then((s) => {
        if (active) setEdit(s);
      })
      .catch((e) => {
        if (active) setEditError(message(e));
      });
    return () => {
      active = false;
    };
  }, [api, editId, mode, version]);
  function updateFilters(f: Filters) {
    setFilters(f);
    history.replaceState(
      null,
      "",
      "#/details" + (filterQuery(f) ? "?" + filterQuery(f) : ""),
    );
  }
  function go(p: Page, q = "") {
    location.hash = "/" + p + (q ? "?" + q : "");
    setPage(p);
  }
  function changed(s: string) {
    setVersion((v) => v + 1);
    setToast(s);
  }
  function newSale() {
    setEdit(undefined);
    go("entry");
  }
  function editSale(s: Sale) {
    setEdit(s);
    go("entry", "id=" + encodeURIComponent(s.id));
  }
  async function signOut() {
    try {
      if (mode === "cloud") await logout();
      sessionStorage.removeItem("zhangyuge-demo");
      setMode("login");
      setEdit(undefined);
      setError("");
      go("dashboard");
    } catch (e) {
      setToast(message(e));
    }
  }
  if (mode === "loading")
    return (
      <div className="boot">
        <Brand />
        <Loading />
      </div>
    );
  if (mode === "login")
    return (
      <div className="welcome">
        <header>
          <Brand />
          <span>PRIVATE WORKSPACE</span>
        </header>
        <main>
          <div className="welcome-copy">
            <span className="welcome-kicker">
              <i /> 为每一份小生意，留一本好账
            </span>
            <h1>
              生意在手，
              <br />
              每一笔<span>心中有数。</span>
            </h1>
            <p>
              记下成交，算清利润。
              <br />
              章鱼哥 AI 工作室的私人销售账本。
            </p>
            <div className="welcome-benefits">
              <span>
                <CheckCircle2 size={17} />
                随手记一笔
              </span>
              <span>
                <CheckCircle2 size={17} />
                每日利润一眼看清
              </span>
              <span>
                <CheckCircle2 size={17} />
                手机电脑同步
              </span>
            </div>
            <div className="welcome-actions">
              {configured ? (
                <button
                  className="button primary"
                  disabled={loginBusy}
                  onClick={() => {
                    setLoginBusy(true);
                    setError("");
                    void login()
                      .catch((e) => setError(message(e)))
                      .finally(() => setLoginBusy(false));
                  }}
                >
                  <Github size={19} />
                  {loginBusy ? "正在打开登录…" : "用 GitHub 登录账本"}
                  <ArrowRight size={18} />
                </button>
              ) : (
                <div className="setup-status">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>云端账本正在准备中</strong>
                    <p>连接完成后，就可以登录并同步记录。</p>
                  </div>
                </div>
              )}
              <button
                className="text-button demo-enter"
                onClick={() => {
                  sessionStorage.setItem("zhangyuge-demo", "true");
                  setMode("demo");
                  go("dashboard");
                }}
              >
                先看看演示账本
                <ArrowRight size={16} />
              </button>
            </div>
            {error && <ErrorNote>{error}</ErrorNote>}
            <small className="welcome-privacy">
              <ShieldCheck size={14} />
              仅本人可访问，销售数据独立保存在云端。
            </small>
          </div>
          <div className="welcome-art">
            <div className="art-label">THE SMALL BUSINESS JOURNAL</div>
            <div className="art-receipt">
              <img
                src={`${import.meta.env.BASE_URL}octopus.svg`}
                alt="章鱼哥标志"
              />
              <span>一 笔 好 生 意</span>
              <div className="art-line" />
              <p>
                今日的认真
                <br />
                明日的收获
              </p>
              <div className="art-chart">
                {[40, 58, 32, 74, 59, 93, 115].map((h, i) => (
                  <i key={i} style={{ height: h }} />
                ))}
              </div>
              <div className="art-bottom">记下每一笔，日子有回响。</div>
            </div>
            <div className="art-stamp">
              KEEP
              <br />
              GROWING ↗
            </div>
          </div>
        </main>
        <footer>
          章鱼哥 AI 工作室 <span>简单记录，安心经营。</span>
        </footer>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">我的工作台</div>
        <nav aria-label="主要导航">
          <button
            className={page === "dashboard" ? "active" : ""}
            onClick={() => go("dashboard")}
          >
            <LayoutDashboard size={19} />
            生意看板
          </button>
          <button
            className={page === "entry" ? "active" : ""}
            onClick={newSale}
          >
            <Plus size={19} />
            记一笔
          </button>
          <button
            className={page === "details" ? "active" : ""}
            onClick={() => {
              setFilters({});
              go("details");
            }}
          >
            <ReceiptText size={19} />
            销售明细
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="tiny-leaf">↗</span>
            <strong>小生意，也有大收获</strong>
            <p>
              记录每一次成交
              <br />
              看见每一点成长
            </p>
          </div>
          <button
            className={`sidebar-settings ${page === "settings" ? "selected" : ""}`}
            onClick={() => go("settings")}
          >
            <SettingsIcon size={18} />
            账本设置
          </button>
          <div className="account">
            <div className="avatar">章</div>
            <div>
              <strong>章鱼哥</strong>
              <span>{mode === "demo" ? "演示工作台" : "个人工作室"}</span>
            </div>
            <button
              className="icon-button"
              onClick={() => void signOut()}
              aria-label="退出账本"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            工作室<span>/</span>
            <strong>
              {
                {
                  dashboard: "生意看板",
                  entry: edit ? "编辑销售" : "记一笔",
                  details: "销售明细",
                  settings: "账本设置",
                }[page]
              }
            </strong>
          </div>
          <div className="topbar-right">
            <span className="privacy-label">
              <ShieldCheck size={14} />
              个人私密账本
            </span>
            <button
              className="icon-button"
              aria-label="刷新账本"
              onClick={() => setVersion((v) => v + 1)}
            >
              <RefreshCw size={16} />
            </button>
            <button
              className="mobile-settings icon-button"
              aria-label="打开设置"
              onClick={() => go("settings")}
            >
              <SettingsIcon size={18} />
            </button>
            <span className="mini-avatar">章</span>
          </div>
        </header>
        {mode === "demo" && (
          <div className="demo-banner">
            <Sparkles size={15} />
            <span>
              演示账本 · 以下为虚构数据，仅保存在本机，请勿录入真实客户。
            </span>
            <button onClick={() => void signOut()}>退出演示</button>
          </div>
        )}
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={16} />
            网络已断开，输入内容会保留为草稿，联网后再保存。
          </div>
        )}
        <main className="main-content">
          {page === "dashboard" && (
            <Dashboard
              api={api}
              version={version}
              onNew={newSale}
              onEdit={editSale}
              onFilter={(f) => {
                setFilters(f);
                go("details", filterQuery(f));
              }}
            />
          )}
          {page === "entry" && editId && !edit && <Loading />}
          {page === "entry" && editError && <ErrorNote>{editError}</ErrorNote>}
          {page === "entry" && (!editId || edit?.id === editId) && (
            <SaleForm
              key={mode + (edit?.id || "new")}
              api={api}
              mode={mode}
              edit={edit}
              onBack={() => go("dashboard")}
              onSaved={(s, stay) => {
                changed(s);
                if (!stay) {
                  setEdit(undefined);
                  go("dashboard");
                }
              }}
            />
          )}
          {page === "details" && (
            <Details
              api={api}
              version={version}
              filters={filters}
              setFilters={updateFilters}
              onEdit={editSale}
              onNew={newSale}
              onChange={changed}
            />
          )}
          {page === "settings" && (
            <Settings
              api={api}
              version={version}
              demo={mode === "demo"}
              onBack={() => go("dashboard")}
              onChange={changed}
              onLogout={() => void signOut()}
            />
          )}
          <footer className="app-footer">
            <span>章鱼哥 AI 工作室</span>
            <span>认真记账，轻松经营。</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="手机导航">
        <button
          className={page === "dashboard" ? "active" : ""}
          onClick={() => go("dashboard")}
        >
          <LayoutDashboard size={20} />
          <span>看板</span>
        </button>
        <button
          className={`mobile-add ${page === "entry" ? "active" : ""}`}
          onClick={newSale}
        >
          <span>
            <Plus size={23} />
          </span>
          <small>记一笔</small>
        </button>
        <button
          className={page === "details" ? "active" : ""}
          onClick={() => {
            setFilters({});
            go("details");
          }}
        >
          <ReceiptText size={20} />
          <span>明细</span>
        </button>
      </nav>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

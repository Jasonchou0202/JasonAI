import { InsightsProvider } from "./lib/insights-ui";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
  CalendarDays,
  ArrowUpRight,
  ChevronDown,
  UserPlus,
  Users,
  ScrollText,
} from "lucide-react";
import { Dashboard } from "./components/Dashboard";
import { SaleForm } from "./components/SaleForm";
import { Details } from "./components/Details";
import { DailyReminders } from "./components/DailyReminders";
import {
  UpdateBoundary,
  installPreloadRecovery,
} from "./components/UpdateBoundary";
import heroArt800 from "./assets/hero-octopus-800.webp";
import { stopPush } from "./lib/notifications";
import { Brand, ErrorNote, Loading, message } from "./components/ui";
import { EdgeFade } from "./components/EdgeFade";
import type { Filters, Sale } from "./domain/model";
import { cloudApi, configured, session, login, logout } from "./lib/cloud";
import { createDemo, demoRole, DEMO_ROLE_KEY } from "./lib/demo";
import { LEGACY_ME, TeamProvider, whoAmI, type Me } from "./lib/team-ui";
import { contentCloudApi } from "./lib/content-api";
import { createContentDemo } from "./lib/content-demo";
import { routeParams, readFilters, filterQuery } from "./lib/routes";
// 日程、客户详情、设置按需加载；进入工作台后空闲时预取，断网时也能打开
const loadSettings = () => import("./components/Settings");
const loadCalendar = () => import("./components/Calendar");
const loadCustomer = () => import("./components/CustomerDetails");
const loadContentEntry = () => import("./components/ContentEntry");
const loadTeam = () => import("./components/Members");
const loadAudit = () => import("./components/AuditLog");
const Members = lazy(() => loadTeam().then((m) => ({ default: m.Members })));
const MemberGate = lazy(() => loadTeam().then((m) => ({ default: m.MemberGate })));
const AuditLog = lazy(() => loadAudit().then((m) => ({ default: m.AuditLog })));
const Settings = lazy(() =>
  loadSettings().then((m) => ({ default: m.Settings })),
);
const Calendar = lazy(() =>
  loadCalendar().then((m) => ({ default: m.Calendar })),
);
const CustomerDetails = lazy(() =>
  loadCustomer().then((m) => ({ default: m.CustomerDetails })),
);
const ContentEntry = lazy(() =>
  loadContentEntry().then((m) => ({ default: m.ContentEntry })),
);
type Page =
  | "dashboard"
  | "entry"
  | "details"
  | "settings"
  | "calendar"
  | "customer"
  | "content-entry"
  | "members"
  | "audit"
  | "my-log";
/** 成员不能进的页面（云端同样拒绝，这里只是不显示） */
const ADMIN_PAGES: Page[] = ["settings", "content-entry", "members", "audit"];
const BOARD = import.meta.env.BASE_URL + "board-e160b241a233/";
const CONTENT_LINKS = [
  [BOARD, "内容闭环看板"],
  [BOARD + "#stages", "七段流水线"],
  [BOARD + "#topics", "选题流水线"],
  [BOARD + "#mechanisms", "机制验证"],
] as const;
function salesCurrent(page: Page, id: Page) {
  if (id === "calendar") return page === "calendar" || page === "customer";
  return page === id;
}
function SalesLinks({
  page,
  onOpen,
  me = LEGACY_ME,
}: {
  page: Page;
  onOpen: (id: Page) => void;
  me?: Me;
}) {
  const admin = me.role === "admin";
  const items: { id: Page; label: string; icon: typeof Plus }[] = [
    { id: "dashboard", label: "生意看板", icon: LayoutDashboard },
    { id: "entry", label: "记一笔", icon: Plus },
    { id: "details", label: "销售明细", icon: ReceiptText },
    { id: "calendar", label: "客户日程", icon: CalendarDays },
    ...(admin ? [{ id: "settings" as Page, label: "账本设置", icon: SettingsIcon }] : []),
    ...(admin && me.membersEnabled ? [{ id: "members" as Page, label: "成员管理", icon: Users }] : []),
    ...(admin && me.auditEnabled ? [{ id: "audit" as Page, label: "操作日志", icon: ScrollText }] : []),
    ...(!admin && me.auditEnabled ? [{ id: "my-log" as Page, label: "我的操作记录", icon: ScrollText }] : []),
  ];
  return (
    <div className="nav-sub">
      {items.map((item) => {
        const Icon = item.icon;
        const active = salesCurrent(page, item.id);
        return (
          <button
            key={item.id}
            type="button"
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
            onClick={() => onOpen(item.id)}
          >
            <Icon size={18} aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
function ContentLinks({
  page,
  onOpen,
}: {
  page: Page;
  onOpen: (id: Page) => void;
}) {
  const active = page === "content-entry";
  return (
    <div className="nav-sub">
      <button
        type="button"
        className={active ? "active" : ""}
        aria-current={active ? "page" : undefined}
        onClick={() => onOpen("content-entry")}
      >
        <UserPlus size={18} aria-hidden="true" />
        今日获客录入
      </button>
      {CONTENT_LINKS.map(([href, label]) => (
        <a key={href} href={href}>
          <ArrowUpRight size={16} aria-hidden="true" />
          {label}
        </a>
      ))}
    </div>
  );
}
function NavGroups({
  page,
  onOpen,
  salesOpen,
  contentOpen,
  onToggle,
  me = LEGACY_ME,
}: {
  page: Page;
  onOpen: (id: Page) => void;
  salesOpen: boolean;
  contentOpen: boolean;
  onToggle: (group: "sales" | "content") => void;
  me?: Me;
}) {
  return (
    <>
      <div className="nav-group">
        <button
          type="button"
          className="nav-summary"
          aria-expanded={salesOpen}
          onClick={() => onToggle("sales")}
        >
          销售板块
          <ChevronDown className="nav-chevron" size={16} aria-hidden="true" />
        </button>
        {salesOpen && <SalesLinks page={page} onOpen={onOpen} me={me} />}
      </div>
      {me.role === "admin" && (
      <div className="nav-group">
        <button
          type="button"
          className="nav-summary"
          aria-expanded={contentOpen}
          onClick={() => onToggle("content")}
        >
          内容生产板块
          <ChevronDown className="nav-chevron" size={16} aria-hidden="true" />
        </button>
        {contentOpen && <ContentLinks page={page} onOpen={onOpen} />}
      </div>
      )}
    </>
  );
}
function readRoute(): Page {
  const p = location.hash.replace("#/", "").split("?")[0];
  return [
    "entry",
    "details",
    "settings",
    "calendar",
    "customer",
    "content-entry",
    "members",
    "audit",
    "my-log",
  ].includes(p)
    ? (p as Page)
    : "dashboard";
}
export default function App() {
  const [mode, setMode] = useState<"loading" | "login" | "cloud" | "demo" | "gate">(
    "loading",
  );
  const [me, setMe] = useState<Me>(LEGACY_ME);
  // 「我是谁」已从后台拿到（之前用默认值，不能据此跳转）
  const [meReady, setMeReady] = useState(false);
  const [page, setPage] = useState<Page>(readRoute);
  const [edit, setEdit] = useState<Sale>();
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [editError, setEditError] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [loginBusy, setLoginBusy] = useState(false);
  const [salesOpen, setSalesOpen] = useState(true);
  const [contentOpen, setContentOpen] = useState(
    () => readRoute() === "content-entry",
  );
  const [mobileSheet, setMobileSheet] = useState<null | "sales" | "content">(
    null,
  );
  useEffect(() => {
    let alive = true;
    session()
      .then(async (ok) => {
        if (ok) {
          try {
            await cloudApi.call("session");
          } catch (e) {
            // 团队模式下：未入队/待批准/已停用 → 显示加入/等待页；否则照原来报错
            const who = await whoAmI(cloudApi);
            if (who.membersEnabled && who.role === "none") {
              if (alive) {
                setMe(who);
                setMode("gate");
              }
              return;
            }
            throw e;
          }
          if (alive) {
            setMode("cloud");
            const pending = sessionStorage.getItem("zhangyuge-return-route");
            if (
              pending &&
              /^#\/(calendar|customer|content-entry)(\?|$)/.test(pending)
            )
              location.hash = pending;
            sessionStorage.removeItem("zhangyuge-return-route");
          }
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
  // 新版本发布后按需文件拿不到：自动刷新一次（记一笔页面除外，免得打断输入）
  useEffect(
    () =>
      installPreloadRecovery(
        () => !["entry", "content-entry"].includes(readRoute()),
      ),
    [],
  );
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, mode]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (mode !== "cloud" && mode !== "demo") return;
    const run = () => {
      void loadCalendar().catch(() => {});
      void loadCustomer().catch(() => {});
      void loadSettings().catch(() => {});
      void loadContentEntry().catch(() => {});
    };
    const idle = (
      window as { requestIdleCallback?: (cb: () => void) => number }
    ).requestIdleCallback;
    if (idle) idle(run);
    else setTimeout(run, 1500);
  }, [mode]);
  const api = useMemo(
    () => (mode === "demo" ? createDemo(demoRole()) : cloudApi),
    [mode],
  );
  // 当前角色：没有团队功能时 = 原来的单人管理员（界面不变）
  useEffect(() => {
    if (mode !== "cloud" && mode !== "demo") return;
    let alive = true;
    setMeReady(false);
    void whoAmI(api).then((m) => {
      if (!alive) return;
      setMe(m);
      setMeReady(true);
    });
    return () => {
      alive = false;
    };
  }, [api, mode]);
  // 路由守卫：成员进不了系统页面（云端同样会拒）
  useEffect(() => {
    if (me.role === "member" && ADMIN_PAGES.includes(page))
      go(page === "audit" ? "my-log" : "dashboard");
    // 功能没开（单人版、普通演示账本）时直接输团队页面地址：回到看板，不出现报错空页
    else if (
      meReady &&
      (((page === "audit" || page === "my-log") && !me.auditEnabled) ||
        (page === "members" && !me.membersEnabled))
    )
      go("dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.role, me.auditEnabled, me.membersEnabled, meReady, page]);
  const contentApi = useMemo(
    () => (mode === "demo" ? createContentDemo() : contentCloudApi),
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
    if (p === "content-entry") setContentOpen(true);
    else setSalesOpen(true);
    setMobileSheet(null);
  }
  function toggleGroup(group: "sales" | "content") {
    if (group === "sales") setSalesOpen((v) => !v);
    else setContentOpen((v) => !v);
  }
  function openSalesItem(id: Page) {
    if (id === "entry") newSale();
    else if (id === "details") {
      setFilters({});
      go("details");
    } else go(id);
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
  function customer(id: string, month?: string) {
    go(
      "customer",
      new URLSearchParams({ id, ...(month ? { month } : {}) }).toString(),
    );
  }
  async function signOut() {
    try {
      let reminderWarning = "";
      if (mode === "cloud") {
        try {
          await stopPush(api);
        } catch {
          reminderWarning =
            "已退出登录；云端提醒撤销未确认，请联网后在设置中重试关闭提醒。";
        }
        await logout();
      }
      sessionStorage.removeItem("zhangyuge-demo");
      sessionStorage.removeItem(DEMO_ROLE_KEY);
      setMe(LEGACY_ME);
      setMode("login");
      setEdit(undefined);
      setError(reminderWarning);
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
  if (mode === "gate")
    return (
      <Suspense fallback={<Loading />}>
        <MemberGate
          api={cloudApi}
          status={me.status === "active" ? "none" : me.status}
          onDone={() => location.reload()}
          onLogout={() => void signOut()}
        />
      </Suspense>
    );
  if (mode === "login")
    return (
      <div className="welcome">
        <header>
          <Brand />
          <span>私人工作台</span>
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
          <div className="welcome-art" aria-hidden="true">
            <img
              src={heroArt800}
              width={800}
              height={800}
              alt=""
              decoding="async"
            />
            <div className="welcome-art-card">
              <span>生意手账</span>
              <strong>每一笔，心中有数</strong>
              <small>利润 = 销售额 − 成本</small>
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
      <button
        type="button"
        className="skip-link"
        onClick={() => document.getElementById("main-content")?.focus()}
      >
        跳到主要内容
      </button>
      <aside className="sidebar" aria-label="侧边栏">
        <Brand />
        <div className="workspace-label">我的工作台</div>
        <nav aria-label="主要导航">
          <NavGroups
            page={page}
            onOpen={openSalesItem}
            salesOpen={salesOpen}
            contentOpen={contentOpen}
            onToggle={toggleGroup}
            me={me}
          />
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
          <div className="account">
            <div className="avatar">{me.role === "member" ? (me.name || "成").slice(0, 1) : "章"}</div>
            <div>
              <strong>{me.role === "member" ? me.name || "团队成员" : "章鱼哥"}</strong>
              <span>{me.role === "member" ? "团队成员" : mode === "demo" ? "演示工作台" : "个人工作室"}</span>
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
        <EdgeFade band="top" />
        <EdgeFade band="left" />
        <header className="topbar">
          <div className="breadcrumb">
            工作室<span>/</span>
            {page === "content-entry" ? "内容生产板块" : "销售板块"}
            <span>/</span>
            <strong>
              {
                {
                  dashboard: "生意看板",
                  entry: edit ? "编辑销售" : "记一笔",
                  details: "销售明细",
                  settings: "账本设置",
                  calendar: "客户日程",
                  customer: "客户详情",
                  "content-entry": "今日获客录入",
                  members: "成员管理",
                  audit: "操作日志",
                  "my-log": "我的操作记录",
                }[page]
              }
            </strong>
          </div>
          <div className="topbar-right">
            <DailyReminders
              key={mode}
              api={api}
              version={version}
              onOpenTask={(id) =>
                go("calendar", new URLSearchParams({ task: id }).toString())
              }
              onOpenCalendar={() => go("calendar")}
            />
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
            {me.role === "admin" && (
              <button
                className="mobile-settings icon-button"
                aria-label="打开设置"
                onClick={() => go("settings")}
              >
                <SettingsIcon size={18} />
              </button>
            )}
            <span className="mini-avatar">{me.role === "member" ? (me.name || "成").slice(0, 1) : "章"}</span>
          </div>
        </header>
        {mode === "demo" && (
          <aside className="demo-banner" aria-label="演示提示">
            <Sparkles size={14} aria-hidden="true" />
            <span className="demo-text">
              演示数据，只存本机，请勿录入真实客户
            </span>
            {demoRole() !== null && (
            <span className="demo-exit">
              <span aria-hidden="true">·</span>
              <button
                aria-label="切换团队预览身份"
                onClick={() => {
                  if (demoRole() === "admin") sessionStorage.setItem(DEMO_ROLE_KEY, "member");
                  else sessionStorage.removeItem(DEMO_ROLE_KEY);
                  location.replace(location.pathname + location.hash);
                }}
              >
                {demoRole() === "admin" ? "看成员视角" : "退出团队预览"}
              </button>
            </span>
            )}
            <span className="demo-exit">
              <span aria-hidden="true">·</span>
              <button aria-label="退出演示" onClick={() => void signOut()}>
                退出
              </button>
            </span>
          </aside>
        )}
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={16} />
            网络已断开，输入内容会保留为草稿，联网后再保存。
          </div>
        )}
        <main className="main-content" id="main-content" tabIndex={-1}>
          {me.role === "admin" && !!me.auditHealth?.failed && (
            <div className="team-banner" role="alert">
              有 {me.auditHealth.failed} 次操作日志未能写入（最近一次 {me.auditHealth.lastFailedAt ? new Date(Date.parse(me.auditHealth.lastFailedAt) + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : ""} 北京时间），记账不受影响，请查看云函数日志。
            </div>
          )}
          <TeamProvider me={me}>
          <InsightsProvider api={api} version={version}>
          <UpdateBoundary key={page}>
            <Suspense fallback={<Loading />}>
              {page === "dashboard" && (
                <Dashboard
                  api={api}
                  version={version}
                  onNew={newSale}
                  onEdit={editSale}
                  onCustomer={customer}
                  onFilter={(f) => {
                    setFilters(f);
                    go("details", filterQuery(f));
                  }}
                />
              )}
              {page === "entry" && editId && !edit && <Loading />}
              {page === "entry" && editError && (
                <ErrorNote>{editError}</ErrorNote>
              )}
              {page === "entry" && (!editId || edit?.id === editId) && (
                <SaleForm
                  key={mode + (edit?.id || "new")}
                  api={api}
                  mode={mode}
                  edit={edit}
                  onProductSaved={() => changed("商品已保存，销售尚未保存")}
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
                  onCustomer={customer}
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
                  onCustomer={customer}
                />
              )}
              {page === "calendar" && (
                <Calendar
                  api={api}
                  version={version}
                  mode={mode}
                  onChange={changed}
                  onCustomer={customer}
                  taskId={routeParams().get("task") || undefined}
                />
              )}
              {page === "content-entry" && (
                <ContentEntry
                  key={mode}
                  api={contentApi}
                  mode={mode}
                  onSaved={(s) => setToast(s)}
                />
              )}
              {page === "customer" && (
                <CustomerDetails
                  key={routeParams().get("id")}
                  api={api}
                  version={version}
                  mode={mode}
                  id={routeParams().get("id") || ""}
                  month={routeParams().get("month") || undefined}
                  onChange={changed}
                  onBack={() => go("dashboard")}
                  onCustomer={customer}
                  onEditSale={editSale}
                />
              )}
              {page === "members" && me.role === "admin" && me.membersEnabled && <Members api={api} />}
              {page === "audit" && me.role === "admin" && me.auditEnabled && <AuditLog api={api} mode="admin" />}
              {page === "my-log" && me.auditEnabled && <AuditLog api={api} mode="self" />}
            </Suspense>
          </UpdateBoundary>
          </InsightsProvider>
          </TeamProvider>
          <footer className="app-footer">
            <span>章鱼哥 AI 工作室</span>
            <span>认真记账，轻松经营。</span>
            <div className="footer-workspace">
              <NavGroups
                page={page}
                onOpen={openSalesItem}
                salesOpen={salesOpen}
                contentOpen={contentOpen}
                onToggle={toggleGroup}
                me={me}
              />
            </div>
          </footer>
        </main>
      </div>
      <div className="mobile-dock">
        <EdgeFade band="bottom" />
        <div className="mobile-sheet" hidden={mobileSheet === null}>
          {mobileSheet === "sales" && (
            <SalesLinks page={page} onOpen={openSalesItem} me={me} />
          )}
          {mobileSheet === "content" && (
            <ContentLinks page={page} onOpen={openSalesItem} />
          )}
        </div>
        <nav className="mobile-nav" aria-label="手机导航">
          <button
            type="button"
            className={mobileSheet !== "content" ? "active" : ""}
            aria-expanded={mobileSheet === "sales"}
            onClick={() =>
              setMobileSheet((s) => (s === "sales" ? null : "sales"))
            }
          >
            <LayoutDashboard size={18} />
            <span>销售板块</span>
          </button>
          <button
            type="button"
            className={`mobile-add ${page === "entry" ? "active" : ""}`}
            onClick={newSale}
          >
            <span>
              <Plus size={23} />
            </span>
            <small>记一笔</small>
          </button>
          {me.role === "admin" && (
            <button
              type="button"
              className={mobileSheet === "content" ? "active" : ""}
              aria-expanded={mobileSheet === "content"}
              onClick={() =>
                setMobileSheet((s) => (s === "content" ? null : "content"))
              }
            >
              <ArrowUpRight size={18} />
              <span>内容生产</span>
            </button>
          )}
        </nav>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

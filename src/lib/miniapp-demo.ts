import type {
  BindCodeResult,
  MiniappApi,
  MiniappApplication,
  MiniappApplicationList,
  MiniappBinding,
  MiniappFlags,
} from "./miniapp-api";
import { ApiError } from "./team-me";

/** 演示「绑定小程序」预览：…/JasonAI/?miniapp-preview=1，示例数据，默认演示不变 */
export const DEMO_MINIAPP_KEY = "zhangyuge-demo-miniapp";
export const DEMO_ROLE_KEY = "zhangyuge-demo-role";

export function demoMiniappPreview(): boolean {
  const fromUrl = new URLSearchParams(location.search).get("miniapp-preview");
  if (fromUrl === "1") {
    sessionStorage.setItem(DEMO_MINIAPP_KEY, "1");
    if (!sessionStorage.getItem(DEMO_ROLE_KEY)) sessionStorage.setItem(DEMO_ROLE_KEY, "admin");
  }
  if (fromUrl === "0") sessionStorage.removeItem(DEMO_MINIAPP_KEY);
  return typeof sessionStorage !== "undefined" && sessionStorage.getItem(DEMO_MINIAPP_KEY) === "1";
}

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function iso(days: number, hour = 10, minute = 0) {
  const t = Date.now() + days * 86400000;
  const d = new Date(t);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** 虚构示例：姓名、手机号都是假的，只给本地预览用 */
function seedApps(): MiniappApplication[] {
  return [
    {
      id: "a_1111111111111111111111111111111111111111",
      name: "示例申请人 · 阿杰",
      phone: "13800001111",
      status: "pending",
      lastAppliedAt: iso(-0.2, 6, 20),
      maybe: [],
    },
    {
      id: "a_2222222222222222222222222222222222222222",
      name: "林小雅",
      phone: "13900002222",
      status: "pending",
      lastAppliedAt: iso(-1, 3, 15),
      maybe: [{ uid: "demo-member", name: "林小雅", status: "active" }],
    },
    {
      id: "a_3333333333333333333333333333333333333333",
      name: "示例申请人 · 小周",
      phone: "137****3333",
      status: "blocked",
      lastAppliedAt: iso(-8, 8, 0),
      decidedAt: iso(-7, 2, 0),
    },
    {
      id: "a_4444444444444444444444444444444444444444",
      name: "示例申请人 · 木木",
      phone: "136****4444",
      status: "rejected",
      lastAppliedAt: iso(-4, 5, 40),
      decidedAt: iso(-3, 9, 10),
    },
  ];
}

function seedBindings(): MiniappBinding[] {
  return [
    {
      id: "b_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      kind: "owner",
      uid: "demo",
      name: "管理员",
      status: "active",
      createdAt: iso(-20, 2, 0),
      lastSeenAt: iso(-0.1, 7, 30),
    },
    {
      id: "b_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      kind: "member",
      uid: "wx_0123456789abcdef0123456789abcdef",
      name: "示例成员 · 阿远",
      status: "active",
      createdAt: iso(-12, 4, 0),
      lastSeenAt: iso(-1, 8, 0),
    },
  ];
}

const DEMO_FLAGS: MiniappFlags = {
  miniappEnabled: true,
  membersEnabled: true,
  auditEnabled: true,
  scheduleOwnerEnabled: false,
  avatarsEnabled: false,
  salesActorFieldsEnabled: false,
  expensesEnabled: false,
  salesPayerEnabled: false,
  expenseReceiptsEnabled: false,
  expenseRenewEnabled: false,
  invoiceEnabled: false,
};

let apps = seedApps();
let bindings = seedBindings();
let lastCode: BindCodeResult | null = null;

function list(): MiniappApplicationList {
  const byTime = (a: MiniappApplication, b: MiniappApplication) =>
    b.lastAppliedAt.localeCompare(a.lastAppliedAt);
  return {
    pending: apps.filter((a) => a.status === "pending").sort(byTime),
    blocked: apps.filter((a) => a.status === "blocked").sort(byTime),
    rejected: apps.filter((a) => a.status === "rejected").sort(byTime),
  };
}

function findApp(id: unknown) {
  return typeof id === "string" ? apps.find((a) => a.id === id) : undefined;
}

function randomCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .slice(0, 8)
    .join("");
}

/** 可重复取同一份示例状态，方便预览里点批准/生成码 */
export function resetDemoMiniapp() {
  apps = seedApps();
  bindings = seedBindings();
  lastCode = null;
}

export function createDemoMiniapp(): MiniappApi {
  return {
    async call<T>(action: string, payload: unknown = {}) {
      const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
      if (action === "miniapp.flags") return DEMO_FLAGS as T;
      if (action === "miniapp.owner.code") {
        lastCode = {
          code: randomCode(),
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        };
        return lastCode as T;
      }
      if (action === "miniapp.apply.list") return list() as T;
      if (action === "miniapp.bind.list") return bindings.slice() as T;
      if (action === "miniapp.bind.revoke") {
        const b = bindings.find((x) => x.id === p.id);
        if (!b) throw new ApiError("绑定不存在", "NOT_FOUND");
        b.status = "revoked";
        return { status: "revoked" } as T;
      }
      if (action === "miniapp.apply.approve") {
        const a = findApp(p.id);
        if (!a || a.status !== "pending") throw new ApiError("这条申请不在待处理状态");
        a.status = "approved";
        a.decidedAt = new Date().toISOString();
        a.linkUid = typeof p.linkUid === "string" ? p.linkUid : null;
        if (!a.linkUid) {
          bindings.unshift({
            id: "b_" + a.id.slice(2),
            kind: "member",
            uid: "wx_demo_" + a.id.slice(-8),
            name: a.name,
            status: "active",
            createdAt: a.decidedAt,
            lastSeenAt: null,
          });
        }
        return { status: "approved", created: !a.linkUid, linked: !!a.linkUid } as T;
      }
      if (action === "miniapp.apply.reject" || action === "miniapp.apply.block") {
        const a = findApp(p.id);
        if (!a) throw new ApiError("申请不存在");
        if (action === "miniapp.apply.reject" && a.status !== "pending")
          throw new ApiError("这条申请不在待处理状态");
        a.status = action === "miniapp.apply.block" ? "blocked" : "rejected";
        a.decidedAt = new Date().toISOString();
        if (action === "miniapp.apply.block") a.phone = a.phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
        return { status: a.status } as T;
      }
      if (action === "miniapp.apply.unblock") {
        const a = findApp(p.id);
        if (!a || a.status !== "blocked") throw new ApiError("这个微信没有被拉黑");
        a.status = "rejected";
        a.decidedAt = null;
        return { status: "rejected" } as T;
      }
      throw new ApiError("演示不支持这个操作", "UNSUPPORTED_ACTION");
    },
  };
}

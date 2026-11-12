import { execute, identity, type Collection, type Context, type Store } from "./service";
import {
  AUDITED_ACTIONS,
  OWNER_AUDITED_ACTIONS,
  appendOnly,
  defaultThrottle,
  guardAudit,
  summarize,
  type AuditInput,
} from "./audit";
import { authorize, DeniedError, executeTeam, hideDeleted, memberResult, ownerOn, salesActorOn, type Actor, type TeamConfig } from "./team";
import { OWNER_ACTIONS, transferOwner } from "./schedule-owner";
import { taskOwner } from "../src/domain/members";

function failure(error: unknown, diagnose?: (code: string) => void) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const safeCode = /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : undefined;
  if (safeCode) diagnose?.(safeCode);
  const text = error instanceof Error ? error.message : "";
  return {
    ok: false as const,
    ...(safeCode ? { code: safeCode } : {}),
    error:
      /[\u4e00-\u9fa5]/.test(text) && text.length <= 200
        ? text
        : "云端操作未完成，请稍后重试",
  };
}

export async function handle(
  store: () => Store,
  ctx: Context,
  event: unknown,
  diagnose?: (code: string) => void,
  extra?: (store: Store, action: string, payload: unknown) => Promise<unknown>,
  team?: TeamConfig,
) {
  // 两个开关都关（或没传）：走原来的路径，一行不差
  if (!team || (!team.membersEnabled && !team.auditEnabled))
    return legacy(store, ctx, event, diagnose, extra);
  return teamHandle(store, ctx, event, team, diagnose, extra);
}

async function legacy(
  store: () => Store,
  ctx: Context,
  event: unknown,
  diagnose?: (code: string) => void,
  extra?: (store: Store, action: string, payload: unknown) => Promise<unknown>,
) {
  try {
    identity(ctx);
    if (!event || typeof event !== "object" || Array.isArray(event))
      throw new Error("请求格式无效");
    const e = event as { action?: unknown; payload?: unknown };
    if (typeof e.action !== "string") throw new Error("请求格式无效");
    return {
      ok: true,
      data: e.action.startsWith("push.") && extra
        ? await extra(store(), e.action, e.payload ?? {})
        : await execute(store(), ctx, e.action, e.payload ?? {}),
    };
  } catch (error) {
    return failure(error, diagnose);
  }
}

const ID = /^[\w-]{1,128}$/;
function targetOf(action: string, p: Record<string, any>): { type?: string; id?: string } {
  const prefix = action.split(".")[0];
  const type =
    prefix === "sales" || prefix === "tasks" || prefix === "products" || prefix === "customers"
      ? prefix
      : prefix === "catalog"
        ? p.kind === "product" ? "products" : p.kind === "customer" ? "customers" : undefined
        : prefix === "members"
          ? action.startsWith("members.invite") ? "invites" : "members"
          : undefined;
  const raw =
    action === "sales.create" || action === "tasks.create"
      ? p.requestId
      : action === "customers.merge" || action === "customers.unmerge"
        ? (p.sourceId ?? p.id)
        : action === "customers.mergeMany"
          ? p.targetId
          : action === "products.create"
            ? p.product?.id
            : prefix === "members" && !action.startsWith("members.invite")
              ? p.uid
              : p.id;
  return { type, id: typeof raw === "string" && ID.test(raw) ? raw : undefined };
}

async function teamHandle(
  store: () => Store,
  ctx: Context,
  event: unknown,
  team: TeamConfig,
  diagnose?: (code: string) => void,
  extra?: (store: Store, action: string, payload: unknown) => Promise<unknown>,
) {
  const now = () => ctx.now?.() || new Date().toISOString();
  let raw: Store | undefined;
  const base = () => (raw ??= store());
  const log = () => appendOnly(base(), now, diagnose);
  let actor: Actor | undefined;
  let action = "";
  let p: Record<string, any> = {};
  let target: { type?: string; id?: string } = {};
  let before: unknown;
  const record = async (input: Omit<AuditInput, "actorUid" | "actorName" | "role" | "action">) => {
    if (!team.auditEnabled || !action) return;
    const requestHash =
      typeof p.requestId === "string" && ID.test(p.requestId)
        ? (await ctx.hash(p.requestId)).slice(0, 16)
        : undefined;
    await log().append({
      actorUid: actor?.uid ?? ctx.uid ?? "anonymous",
      actorName: actor?.name ?? "",
      role: actor?.role ?? "none",
      action,
      ...(requestHash ? { requestHash } : {}),
      ...input,
    });
  };
  const throttle = team.throttle ?? defaultThrottle;
  try {
    if (team.auditEnabled)
      for (const summary of throttle.flush(now())) await log().append(summary);
    if (!event || typeof event !== "object" || Array.isArray(event))
      throw new Error("请求格式无效");
    const e = event as { action?: unknown; payload?: unknown };
    if (typeof e.action !== "string") throw new Error("请求格式无效");
    action = /^[\w.]{1,60}$/.test(e.action) ? e.action : e.action.slice(0, 60);
    const payload = e.payload ?? {};
    if (payload && typeof payload === "object" && !Array.isArray(payload))
      p = payload as Record<string, any>;
    actor = await authorize(base(), ctx, team, action, p);
    const audited =
      team.auditEnabled && (AUDITED_ACTIONS.has(action) || (ownerOn(team) && OWNER_AUDITED_ACTIONS.has(action)));
    let data: unknown;
    if (action.startsWith("members.") || action === "audit.list") {
      const r = await executeTeam(base(), ctx, team, actor, action, p, now);
      data = r.data;
      if (audited && r.target)
        await record({
          targetType: r.target.type,
          targetId: r.target.id,
          before: summarize(r.target.type, r.target.before),
          after: summarize(r.target.type, r.target.after),
          result: "ok",
        });
      return { ok: true, data };
    }
    // 认领 / 指派（开关关时不进这里：管理员照旧得到 UNSUPPORTED_ACTION，成员照旧被白名单拒）
    if (ownerOn(team) && OWNER_ACTIONS.has(action)) {
      target = audited ? targetOf(action, p) : {};
      const r = await transferOwner(guardAudit(base()), { ...ctx, now }, actor, action, p, now);
      if (audited)
        await record({
          targetType: "tasks",
          targetId: r.target.id,
          before: summarize("tasks", r.target.before),
          after: summarize("tasks", r.target.after),
          result: "ok",
        });
      return { ok: true, data: r.data };
    }
    if (action === "session" && team.membersEnabled)
      return { ok: true, data: { uid: actor.uid, role: actor.role, name: actor.name } };
    target = audited ? targetOf(action, p) : {};
    if (audited && target.type && target.id && !action.endsWith(".create"))
      before = await base().get(target.type as Collection, target.id).catch(() => undefined);
    // 成员通过了 authorize：以所有者身份进入原有业务代码（原有 identity 校验不变），
    // 同时带上真实操作人，用于写 createdBy。
    const autoCreated: string[] = [];
    const execCtx: Context = {
      ...ctx,
      uid: ctx.ownerUid,
      ...(team.membersEnabled ? { actorUid: actor.uid } : {}),
      ...(team.auditEnabled ? { onAutoCreate: (ids: string[]) => void autoCreated.push(...ids) } : {}),
      // 冻结集合的新字段：各自开关开才写（关着时不带这个键，业务代码与现在一字不差）
      ...(ownerOn(team) || salesActorOn(team)
        ? { actorFields: { ...(ownerOn(team) ? { tasks: true } : {}), ...(salesActorOn(team) ? { sales: true } : {}) } }
        : {}),
    };
    // 成员的读操作：看不到回收站里的销售/日程（含 dashboard、客户详情、导出等全部读路径）
    const memberRead = actor.role === "member" && !AUDITED_ACTIONS.has(action);
    const business = memberRead ? hideDeleted(guardAudit(base())) : guardAudit(base());
    data =
      action.startsWith("push.") && extra
        ? await extra(business, action, payload)
        : await execute(business, execCtx, action, payload);
    if (actor.role === "member") data = memberResult(action, data);
    if (autoCreated.length)
      await log().append({
        actorUid: "system:auto",
        actorName: "系统·自动补建客户",
        role: "system",
        action: "customers.autoCreate",
        targetType: "customers",
        targetId: autoCreated[0],
        after: { count: autoCreated.length, ids: autoCreated.slice(0, 20) },
        result: "ok",
      });
    if (audited) {
      let afterSummary = action.startsWith("push.") ? null : summarize(target.type ?? action, data);
      // 删除留痕：补上归属人，并标记「删的是别人的」
      if (action === "tasks.delete" && ownerOn(team) && before && afterSummary) {
        const owner = taskOwner(before as { ownerUid?: string; createdBy?: string }, ctx.ownerUid);
        afterSummary = { ...afterSummary, owner, ...(owner !== actor.uid ? { othersRecord: true } : {}) };
      }
      await record({
        ...(target.type ? { targetType: target.type } : {}),
        ...(target.id ? { targetId: target.id } : {}),
        before: action.startsWith("push.") ? null : summarize(target.type, before),
        after: afterSummary,
        result: "ok",
      });
    }
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DeniedError) {
      actor ??= error.actor;
      // 被拒不逐条写库：非成员按 uid+代码、成员按 uid+action+代码，每小时首条 + 过小时汇总
      if (team.auditEnabled && action) {
        const uid = actor?.uid ?? ctx.uid ?? "anonymous";
        const member = actor?.role === "member";
        const key = member ? `m:${uid}:${action}:${error.code}` : `n:${uid}:${error.code}`;
        const tid = targetOf(action, p).id;
        const entries = throttle.note(key, {
          actorUid: uid,
          actorName: actor?.name ?? "",
          role: actor?.role ?? "none",
          action,
          ...(target.type ? { targetType: target.type } : {}),
          ...(tid ? { targetId: tid } : {}),
          result: "denied",
          reason: error.code,
        }, now());
        try {
          for (const entry of entries) await log().append(entry);
        } catch {
          /* appendOnly 自己已兜底告警 */
        }
      }
    } else if (team.auditEnabled && (AUDITED_ACTIONS.has(action) || (ownerOn(team) && OWNER_AUDITED_ACTIONS.has(action)))) {
      await record({
        ...(target.type ? { targetType: target.type } : {}),
        ...(target.id ? { targetId: target.id } : {}),
        result: "failed",
        reason: "BUSINESS_ERROR",
      }).catch(() => undefined);
    }
    return failure(error, diagnose);
  }
}

import { createECDH, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerTask } from "../src/domain/model";
import type {
  Collection,
  Context,
  Store,
  Transaction,
} from "../server/service";
import {
  pushAction,
  pushConfigFromEnv,
  subscriptionId,
  validatePushEndpoint,
  validatePushSubscription,
  REMINDER_HEALTH_ID,
  type PushConfig,
  type PushSender,
  type PushSubscription,
  type PushNotification,
} from "../server/push";
import {
  runReminders,
  reminderDeliveryId,
  REMINDER_ADVANCE_MS,
  REMINDER_LEASE_MS,
  type ReminderDelivery,
} from "../server/reminders";

const mockSendNotification = vi.hoisted(() => vi.fn());
const cloudMock = vi.hoisted(() => ({
  init: vi.fn(),
  getAuthContext: vi.fn(),
  parseContext: vi.fn(),
  database: vi.fn(),
  healthWrite: vi.fn(),
}));
vi.mock("web-push", () => ({
  default: { sendNotification: mockSendNotification },
}));
vi.mock("@cloudbase/node-sdk", () => ({
  default: {
    SYMBOL_CURRENT_ENV: "test-env",
    init: cloudMock.init,
    parseContext: cloudMock.parseContext,
  },
}));
import { main, isReminderTimer, webPushSender } from "../server/reminder-cloud";

// Serialized, rollback-capable fake; network calls fail if made inside a transaction.
class FakeStore implements Store {
  data = new Map<string, unknown>();
  private queue: Promise<void> = Promise.resolve();
  private transactionScope = new AsyncLocalStorage<boolean>();
  get inTransaction() {
    return this.transactionScope.getStore() === true;
  }
  transactions = 0;
  reads = 0;
  afterTransaction?: (count: number) => void | Promise<void>;
  async get<T>(c: Collection, id: string): Promise<T | null> {
    this.reads++;
    return structuredClone(this.data.get(c + "/" + id) ?? null) as T | null;
  }
  async put<T>(c: Collection, id: string, value: T): Promise<void> {
    this.data.set(c + "/" + id, structuredClone(value));
  }
  async del(c: Collection, id: string): Promise<void> {
    this.data.delete(c + "/" + id);
  }
  async list<T>(c: Collection): Promise<T[]> {
    this.reads++;
    return [...this.data]
      .filter(([key]) => key.startsWith(c + "/"))
      .map(([, value]) => structuredClone(value) as T);
  }
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const prior = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    const saved = structuredClone(this.data);
    try {
      const result = await this.transactionScope.run(true, () => fn(this));
      await this.afterTransaction?.(++this.transactions);
      return result;
    } catch (e) {
      this.data = saved;
      throw e;
    } finally {
      release();
    }
  }
}
const owner = "owner";
const ec = createECDH("prime256v1");
ec.generateKeys();
const config: PushConfig = {
  publicKey: ec.getPublicKey().toString("base64url"),
  privateKey: ec.getPrivateKey().toString("base64url"),
  subject: "https://jasonchou0202.github.io/JasonAI/",
  ownerUid: owner,
};
const keys = {
  p256dh: config.publicKey,
  auth: Buffer.alloc(16, 7).toString("base64url"),
};
const due = Date.parse("2026-10-13T05:00:00.000Z");
const iso = (time: number) => new Date(time).toISOString();
const ctx = (time = due): Context => ({
  uid: owner,
  ownerUid: owner,
  now: () => iso(time),
  hash: async (value) => createHash("sha256").update(value).digest("hex"),
});
const task: CustomerTask = {
  id: "task-1",
  customerId: "secret-customer",
  at: iso(due),
  title: "PRIVATE TITLE",
  feedback: "PRIVATE FEEDBACK",
  nextAction: "PRIVATE PROFIT",
  reminder: "due",
  completedAt: null,
  deletedAt: null,
  createdAt: iso(due - 3_600_000),
  updatedAt: iso(due - 3_600_000),
  revision: 1,
  reminderGeneration: "generation-1",
  reminderStartAt: iso(due - 3_600_000),
};
async function fixture(change: Partial<CustomerTask> = {}) {
  const store = new FakeStore(),
    sent: Array<{ sub: PushSubscription; notification: PushNotification }> = [];
  const subscription: PushSubscription = {
    id: subscriptionId(owner, "https://fcm.googleapis.com/fcm/send/device-1"),
    uid: owner,
    endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
    keys,
    active: true,
    createdAt: iso(due - 3_600_000),
    updatedAt: iso(due - 3_600_000),
  };
  await store.put("tasks", task.id, { ...task, ...change });
  await store.put("subscriptions", subscription.id, subscription);
  const send: PushSender = async (sub, notification) => {
    expect(store.inTransaction).toBe(false);
    sent.push({ sub, notification });
    return { statusCode: 201 };
  };
  return { store, sent, send, subscription };
}
const rows = (store: FakeStore) => store.list<ReminderDelivery>("deliveries");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  mockSendNotification.mockReset();
  for (const mock of Object.values(cloudMock)) mock.mockReset();
});

describe("push API and endpoint security", () => {
  it("authorizes every operation before database access, ignoring forged payload uid", async () => {
    const store = new FakeStore();
    for (const action of [
      "push.config",
      "push.subscribe",
      "push.status",
      "push.unsubscribe",
      "push.test",
    ])
      for (const uid of [null, "intruder"])
        await expect(
          pushAction(
            store,
            { ...ctx(), uid },
            action,
            { uid: owner },
            config,
            vi.fn(),
          ),
        ).rejects.toThrow("无权访问");
    await expect(
      pushAction(
        store,
        { ...ctx(), ownerUid: "" },
        "push.config",
        {},
        config,
        vi.fn(),
      ),
    ).rejects.toThrow("尚未绑定");
    expect(store.reads).toBe(0);
    expect(store.data.size).toBe(0);
  });
  it("uses the frontend contract and never exposes endpoint, auth or private VAPID key", async () => {
    const f = await fixture();
    expect(
      await pushAction(f.store, ctx(), "push.config", {}, config, f.send),
    ).toEqual({ publicKey: config.publicKey, configured: true });
    expect(
      await pushAction(f.store, ctx(), "push.status", {}, config, f.send),
    ).toEqual({ configured: true, active: false });
    const subscribed = await pushAction(
      f.store,
      ctx(),
      "push.subscribe",
      { subscription: { endpoint: f.subscription.endpoint, keys } },
      config,
      f.send,
    );
    expect(subscribed).toEqual({ id: f.subscription.id });
    const statuses = [
      subscribed,
      await pushAction(
        f.store,
        ctx(),
        "push.status",
        { id: f.subscription.id },
        config,
        f.send,
      ),
    ];
    expect(JSON.stringify(statuses)).not.toContain("endpoint");
    expect(JSON.stringify(statuses)).not.toContain(keys.auth);
    expect(JSON.stringify(statuses)).not.toContain(config.privateKey);
    await pushAction(
      f.store,
      ctx(),
      "push.unsubscribe",
      { id: f.subscription.id },
      config,
      f.send,
    );
    expect(
      await pushAction(
        f.store,
        ctx(),
        "push.status",
        { id: f.subscription.id },
        config,
        f.send,
      ),
    ).toEqual({ configured: true, active: false });
  });
  it("rejects other-owner device IDs for status, unsubscribe and test", async () => {
    const f = await fixture();
    await f.store.put("subscriptions", f.subscription.id, {
      ...f.subscription,
      uid: "other",
    });
    for (const action of ["push.status", "push.unsubscribe", "push.test"])
      await expect(
        pushAction(
          f.store,
          ctx(),
          action,
          { id: f.subscription.id },
          config,
          f.send,
        ),
      ).rejects.toThrow("无权操作");
    expect(f.sent).toHaveLength(0);
  });
  it.each(["manual", "timer"] as const)("exposes only safe %s scheduler status to the owner, even without a device", async (source) => {
    const f = await fixture();
    await f.store.put("batches", REMINDER_HEALTH_ID, {
      lastRunAt: iso(due), source, attempted: 7,
      privateKey: config.privateKey, endpoint: f.subscription.endpoint,
    });
    for (const payload of [{}, { id: f.subscription.id }]) {
      expect(await pushAction(f.store, ctx(), "push.status", payload, config, f.send)).toEqual({
        configured: true,
        active: "id" in payload,
        schedulerLastRunAt: iso(due), schedulerSource: source,
      });
      const reads = f.store.reads;
      for (const uid of [null, "intruder"])
        await expect(pushAction(f.store, { ...ctx(), uid }, "push.status", { ...payload, uid: owner }, config, f.send)).rejects.toThrow("无权访问");
      expect(f.store.reads).toBe(reads);
    }
  });
  it("does not report missing or malformed scheduler health as verified", async () => {
    const f = await fixture();
    for (const health of [null, { lastRunAt: "invalid", source: "timer" }, { lastRunAt: iso(due), source: "forged" }]) {
      await f.store.put("batches", REMINDER_HEALTH_ID, health);
      expect(await pushAction(f.store, ctx(), "push.status", {}, config, f.send)).toEqual({ configured: true, active: false });
    }
  });
  it("exposes only the generic scheduler failure and clears it after a successful health record", async () => {
    const f = await fixture();
    await f.store.put("batches", REMINDER_HEALTH_ID, {
      lastRunAt: iso(due), source: "timer", error: "REMINDER_EXECUTION_FAILED",
      rawError: config.privateKey,
    });
    expect(await pushAction(f.store, ctx(), "push.status", {}, config, f.send)).toEqual({
      configured: true, active: false, schedulerLastRunAt: iso(due),
      schedulerSource: "timer", schedulerError: "REMINDER_EXECUTION_FAILED",
    });
    await f.store.put("batches", REMINDER_HEALTH_ID, { lastRunAt: iso(due), source: "timer" });
    expect(await pushAction(f.store, ctx(), "push.status", {}, config, f.send)).not.toHaveProperty("schedulerError");
  });
  it.each([
    "http://fcm.googleapis.com/send",
    "https://127.0.0.1/send",
    "https://[::1]/send",
    "https://169.254.169.254/latest/meta-data",
    "https://192.168.1.1/send",
    "https://localhost/send",
    "https://fcm.googleapis.com.evil.test/send",
    "https://evilpush.apple.com/send",
    "https://push.apple.com/send",
    "https://x.push.apple.com.evil.test/send",
    "https://evil.test/?https://fcm.googleapis.com",
    "https://fcm.googleapis.com:444/send",
    "https://evil@fcm.googleapis.com/send",
    "https://fcm.googleapis.com./send",
    "https://fcm.googleapis.com/send#redirect",
    "https://fcm.googleapis.com\\@evil.test/send",
    "https://notify.windows.com/send",
    "https://evilnotify.windows.com/send",
    "https://wns.notify.windows.com.evil.test/send",
    "https://wns.notify.windows.com:444/send",
    "https://evil@wns.notify.windows.com/send",
    "https://wns.notify.windows.com/send#redirect",
  ])("blocks disallowed endpoint %s", (endpoint) => {
    expect(() => validatePushEndpoint(endpoint)).toThrow("地址无效");
  });
  it("allows exact providers on HTTPS443 and validates canonical base64url key lengths and EC points", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com:443/send",
      "https://updates.push.services.mozilla.com/send",
      "https://web.push.apple.com/send",
      "https://wns2-test.notify.windows.com/w/?token=test",
    ])
      expect(validatePushSubscription({ endpoint, keys }).endpoint).toContain(
        "https://",
      );
    for (const bad of [
      "",
      "x".repeat(22),
      keys.auth + "=",
      "a/b+c",
      "a".repeat(1000),
    ])
      expect(() =>
        validatePushSubscription({
          endpoint: "https://fcm.googleapis.com/send",
          keys: { ...keys, auth: bad },
        }),
      ).toThrow();
    expect(() =>
      validatePushSubscription({
        endpoint: "https://fcm.googleapis.com/send",
        keys: { ...keys, p256dh: Buffer.alloc(65).toString("base64url") },
      }),
    ).toThrow();
    expect(subscriptionId(owner, "https://fcm.googleapis.com/send")).not.toBe(
      subscriptionId("other", "https://fcm.googleapis.com/send"),
    );
  });
  it("registers Edge alongside iPhone and sends both device tests and scheduled reminders", async () => {
    const f = await fixture();
    const endpoints = [
      "https://wns2-test.notify.windows.com/w/?token=test",
      "https://web.push.apple.com/test",
    ];
    for (const endpoint of endpoints) {
      const registered = (await pushAction(
        f.store,
        ctx(),
        "push.subscribe",
        { subscription: { endpoint, keys } },
        config,
        f.send,
      )) as { id: string };
      expect(
        await pushAction(
          f.store,
          ctx(),
          "push.test",
          registered,
          config,
          f.send,
        ),
      ).toEqual({ accepted: true });
    }
    f.sent.length = 0;
    await runReminders(f.store, config, f.send, due);
    expect(f.sent.map(({ sub }) => sub.endpoint)).toEqual(
      expect.arrayContaining(endpoints),
    );
    expect(f.sent).toHaveLength(3);
  });
  it("does not fake success without a private key, and accepts HTTPS subject", async () => {
    const f = await fixture(),
      missing = { ...config, privateKey: "" };
    expect(
      await pushAction(f.store, ctx(), "push.config", {}, missing, f.send),
    ).toEqual({ publicKey: config.publicKey, configured: false });
    await expect(
      pushAction(
        f.store,
        ctx(),
        "push.test",
        { id: f.subscription.id },
        missing,
        f.send,
      ),
    ).rejects.toThrow("尚未配置");
    await expect(
      pushAction(
        f.store,
        ctx(),
        "push.subscribe",
        { subscription: f.subscription },
        missing,
        f.send,
      ),
    ).rejects.toThrow("尚未配置");
    expect(
      (await runReminders(f.store, missing, f.send, iso(due))).configured,
    ).toBe(false);
    expect(f.sent).toHaveLength(0);
    expect(await rows(f.store)).toHaveLength(0);
    expect(
      pushConfigFromEnv({
        VAPID_PUBLIC_KEY: "public",
        VAPID_PRIVATE_KEY: "private",
        VAPID_SUBJECT: config.subject,
        OWNER_UID: owner,
      }),
    ).toEqual({
      publicKey: "public",
      privateKey: "private",
      subject: config.subject,
      ownerUid: owner,
    });
  });
  it("tests only the selected device, accepts rather than claims receipt, and limits concurrent clicks for 30 seconds", async () => {
    const f = await fixture(),
      second = {
        ...f.subscription,
        id: "a".repeat(64),
        endpoint: "https://fcm.googleapis.com/fcm/send/device-2",
      };
    await f.store.put("subscriptions", second.id, second);
    const call = (time: number) =>
      pushAction(
        f.store,
        ctx(time),
        "push.test",
        { id: f.subscription.id },
        config,
        f.send,
      );
    const clicks = await Promise.allSettled(
      Array.from({ length: 8 }, () => call(due)),
    );
    expect(clicks.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        clicks.find(
          (x) => x.status === "fulfilled",
        ) as PromiseFulfilledResult<unknown>
      ).value,
    ).toEqual({ accepted: true });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].sub.id).toBe(f.subscription.id);
    expect(f.sent[0].notification).toEqual({ taskId: "", tag: "teststable" });
    await expect(call(due + 29_999)).rejects.toThrow("30秒");
    await expect(call(due + 30_000)).resolves.toEqual({ accepted: true });
    expect(
      await pushAction(
        f.store,
        ctx(),
        "push.status",
        { id: f.subscription.id },
        config,
        f.send,
      ),
    ).toEqual({
      configured: true,
      active: true,
      lastAcceptedAt: iso(due + 30_000),
    });
  });
  it("records sanitized test failures and disables expired subscriptions", async () => {
    const f = await fixture();
    const bad: PushSender = async () => {
      throw {
        statusCode: 410,
        message: config.privateKey,
        body: f.subscription.endpoint,
        headers: keys,
      };
    };
    await expect(
      pushAction(
        f.store,
        ctx(),
        "push.test",
        { id: f.subscription.id },
        config,
        bad,
      ),
    ).rejects.toThrow("未被接受");
    expect(
      await pushAction(
        f.store,
        ctx(),
        "push.status",
        { id: f.subscription.id },
        config,
        bad,
      ),
    ).toEqual({
      configured: true,
      active: false,
      lastError: "subscription_expired",
    });
    expect(JSON.stringify(await rows(f.store))).not.toContain(
      config.privateKey,
    );
    expect(JSON.stringify(await rows(f.store))).not.toContain(
      f.subscription.endpoint,
    );
  });
});

describe("minute reminder ticks", () => {
  it("limits a batch to 20 sends and four concurrent network calls, leaving remaining work for the next tick", async () => {
    const f = await fixture();
    for (let i = 2; i <= 25; i++)
      await f.store.put("tasks", "task-" + i, { ...task, id: "task-" + i });
    let active = 0,
      maximum = 0;
    const send: PushSender = async (s, n) => {
      expect(f.store.inTransaction).toBe(false);
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      return f.send(s, n);
    };
    const first = await runReminders(f.store, config, send, due);
    expect(first).toMatchObject({ attempted: 20, accepted: 20, deferred: 5 });
    expect(maximum).toBe(4);
    expect(await rows(f.store)).toHaveLength(20);
    const next = await runReminders(f.store, config, send, due + 60_000);
    expect(next).toMatchObject({ attempted: 5, accepted: 5 });
    expect(f.sent).toHaveLength(25);
    expect(new Set(f.sent.map((x) => x.notification.tag)).size).toBe(25);
  });
  it("stops claiming when the cloud budget cannot cover a send and finalization", async () => {
    const f = await fixture();
    const result = await runReminders(f.store, config, f.send, due, {
      deadlineMs: Date.now() + 11_000,
    });
    expect(result).toMatchObject({ attempted: 0, deferred: 1 });
    expect(await rows(f.store)).toHaveLength(0);
    expect(f.sent).toHaveLength(0);
  });
  it("is idempotent under concurrent ticks and feedback edits in the same generation", async () => {
    const f = await fixture();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        runReminders(f.store, config, f.send, iso(due)),
      ),
    );
    expect(f.sent).toHaveLength(1);
    const delivery = (await rows(f.store))[0];
    expect(delivery.id).toBe(
      reminderDeliveryId(
        task.id,
        task.reminderGeneration,
        0,
        f.subscription.id,
      ),
    );
    expect(delivery).toMatchObject({
      state: "accepted",
      attempts: 1,
      acceptedAt: iso(due),
    });
    expect(delivery).not.toHaveProperty("deliveredAt");
    await f.store.put("tasks", task.id, {
      ...task,
      feedback: "edited",
      revision: 2,
    });
    await runReminders(f.store, config, f.send, iso(due + 60_000));
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].notification).toEqual({
      taskId: task.id,
      tag: delivery.tag,
    });
    expect(Object.keys(f.sent[0].notification).sort()).toEqual([
      "tag",
      "taskId",
    ]);
    expect(JSON.stringify(f.sent[0].notification)).not.toContain("PRIVATE");
  });
  it("sends both offsets once with stable tags and skips equal-to-start/past/late/off/completed/deleted schedules", async () => {
    const f = await fixture({ reminder: "both" });
    await runReminders(f.store, config, f.send, due - REMINDER_ADVANCE_MS);
    await runReminders(f.store, config, f.send, due);
    expect(f.sent).toHaveLength(2);
    expect(new Set(f.sent.map((x) => x.notification.tag)).size).toBe(2);
    for (const [change, now] of [
      [{ reminderStartAt: iso(due) }, due],
      [{ reminderStartAt: iso(due + 1) }, due + 1],
      [{}, due - 1],
      [{}, due + 10 * 60_000],
      [{}, due + 15 * 60_000],
      [{ reminder: "off" }, due],
      [{ completedAt: iso(due - 1) }, due],
      [{ deletedAt: iso(due - 1) }, due],
    ] as Array<[Partial<CustomerTask>, number]>) {
      const skip = await fixture(change);
      await runReminders(skip.store, config, skip.send, now);
      expect(skip.sent).toHaveLength(0);
    }
    const fresh = await fixture({
      reminder: "both",
      reminderStartAt: iso(due - REMINDER_ADVANCE_MS),
    });
    await runReminders(
      fresh.store,
      config,
      fresh.send,
      due - REMINDER_ADVANCE_MS,
    );
    await runReminders(fresh.store, config, fresh.send, due);
    expect(fresh.sent).toHaveLength(1);
  });
  it.each([
    { completedAt: iso(due) },
    { deletedAt: iso(due) },
    { reminder: "off" as const },
    { reminderGeneration: "new-generation" },
    { at: iso(due + 3_600_000) },
  ])("rechecks task mutations before send: %j", async (change) => {
    const f = await fixture();
    f.store.afterTransaction = async (count) => {
      if (count === 1)
        await f.store.put("tasks", task.id, { ...task, ...change });
    };
    expect((await runReminders(f.store, config, f.send, due)).cancelled).toBe(
      1,
    );
    expect(f.sent).toHaveLength(0);
    expect((await rows(f.store))[0].state).toBe("cancelled");
  });
  it("rechecks unsubscribe before send, and never sends another owner's subscription", async () => {
    const f = await fixture();
    f.store.afterTransaction = async (count) => {
      if (count === 1)
        await f.store.put("subscriptions", f.subscription.id, {
          ...f.subscription,
          active: false,
        });
    };
    await runReminders(f.store, config, f.send, due);
    expect(f.sent).toHaveLength(0);
    const other = await fixture();
    await other.store.put("subscriptions", other.subscription.id, {
      ...other.subscription,
      uid: "intruder",
    });
    await runReminders(other.store, config, other.send, due);
    expect(other.sent).toHaveLength(0);
  });
  it("pauses the scan and pre-send recheck during ledger restore", async () => {
    const f = await fixture();
    await f.store.put("batches", "_ledger", { restoreId: "restore-id" });
    expect((await runReminders(f.store, config, f.send, due)).paused).toBe(
      true,
    );
    expect(await rows(f.store)).toHaveLength(0);
    await f.store.put("batches", "_ledger", { restoreId: null });
    f.store.afterTransaction = async (count) => {
      if (count === 1)
        await f.store.put("batches", "_ledger", {
          restoreId: "restoring-again",
        });
    };
    expect((await runReminders(f.store, config, f.send, due)).paused).toBe(
      true,
    );
    expect(f.sent).toHaveLength(0);
    expect((await rows(f.store))[0].attempts).toBe(0);
    f.store.afterTransaction = undefined;
    await f.store.put("batches", "_ledger", { restoreId: null });
    await runReminders(f.store, config, f.send, due + 60_000);
    expect(f.sent).toHaveLength(1);
  });
  it.each([404, 410, 403, 302])(
    "settles status %s without retries or exposing provider secrets",
    async (statusCode) => {
      const f = await fixture();
      const send: PushSender = async () => {
        throw {
          statusCode,
          body: config.privateKey,
          headers: keys,
          message: f.subscription.endpoint,
        };
      };
      await runReminders(f.store, config, send, due);
      await runReminders(f.store, config, f.send, due + 120_000);
      expect(f.sent).toHaveLength(0);
      const d = (await rows(f.store))[0];
      expect(d).toMatchObject({
        state: [404, 410].includes(statusCode) ? "unsubscribed" : "failed",
        attempts: 1,
      });
      expect(
        (
          await f.store.get<PushSubscription>(
            "subscriptions",
            f.subscription.id,
          )
        )?.active,
      ).toBe(![404, 410].includes(statusCode));
      expect(JSON.stringify(d)).not.toContain(config.privateKey);
      expect(JSON.stringify(d)).not.toContain(f.subscription.endpoint);
    },
  );
  it.each([429, 500, 503, 0])(
    "retries %s every two minutes at most three attempts with the same tag",
    async (statusCode) => {
      const f = await fixture(),
        tags: string[] = [];
      const failing: PushSender = async (_, n) => {
        expect(f.store.inTransaction).toBe(false);
        tags.push(n.tag);
        throw { statusCode };
      };
      await runReminders(f.store, config, failing, due);
      expect((await rows(f.store))[0]).toMatchObject({
        state: "retry",
        attempts: 1,
      });
      await runReminders(f.store, config, failing, due + 119_999);
      expect(tags).toHaveLength(1);
      await runReminders(f.store, config, failing, due + 120_000);
      await runReminders(f.store, config, failing, due + 240_000);
      await runReminders(f.store, config, failing, due + 360_000);
      expect(tags).toHaveLength(3);
      expect(new Set(tags).size).toBe(1);
      expect((await rows(f.store))[0]).toMatchObject({
        state: "failed",
        attempts: 3,
      });
    },
  );
  it("can accept a retry and clears the subscription error without duplicating accepted sends", async () => {
    const f = await fixture();
    await runReminders(
      f.store,
      config,
      async () => {
        throw { statusCode: 503 };
      },
      due,
    );
    await runReminders(f.store, config, f.send, due + 120_000);
    await runReminders(f.store, config, f.send, due + 240_000);
    expect(f.sent).toHaveLength(1);
    expect((await rows(f.store))[0]).toMatchObject({
      state: "accepted",
      attempts: 2,
    });
    expect(
      await f.store.get("subscriptions", f.subscription.id),
    ).not.toHaveProperty("lastError");
  });
  it("settles pending retries after cancellation and expires them after ten minutes", async () => {
    for (const cancelled of [true, false]) {
      const f = await fixture();
      await runReminders(
        f.store,
        config,
        async () => {
          throw { statusCode: 429 };
        },
        due,
      );
      if (cancelled)
        await f.store.put("tasks", task.id, {
          ...task,
          completedAt: iso(due + 1),
        });
      await runReminders(
        f.store,
        config,
        f.send,
        due + (cancelled ? 120_000 : 15 * 60_000),
      );
      expect(f.sent).toHaveLength(0);
      expect((await rows(f.store))[0]).toMatchObject({
        state: "cancelled",
        lastError: cancelled ? "task_cancelled" : "reminder_expired",
      });
    }
  });
  it("recovers a crashed lease only after both lease expiry and the two-minute retry delay", async () => {
    const f = await fixture(),
      id = reminderDeliveryId(
        task.id,
        task.reminderGeneration,
        0,
        f.subscription.id,
      );
    await f.store.put<ReminderDelivery>("deliveries", id, {
      id,
      uid: owner,
      taskId: task.id,
      generation: task.reminderGeneration,
      offset: 0,
      subscriptionId: f.subscription.id,
      scheduledAt: iso(due),
      tag: "stable-crashed-tag",
      state: "leased",
      attempts: 1,
      createdAt: iso(due),
      updatedAt: iso(due),
      leaseToken: "crashed",
      leaseUntil: iso(due + REMINDER_LEASE_MS),
      nextAttemptAt: iso(due + 120_000),
    });
    await runReminders(f.store, config, f.send, due + 30_000);
    await runReminders(f.store, config, f.send, due + 90_000);
    expect(f.sent).toHaveLength(0);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        runReminders(f.store, config, f.send, due + 120_000),
      ),
    );
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].notification.tag).toBe("stable-crashed-tag");
    expect((await rows(f.store))[0]).toMatchObject({
      state: "accepted",
      attempts: 2,
    });
  });
  it("does not disable a renewed subscription on a stale 410 response", async () => {
    const f = await fixture();
    const send: PushSender = async () => {
      await f.store.put("subscriptions", f.subscription.id, {
        ...f.subscription,
        updatedAt: iso(due + 1),
        active: true,
      });
      throw { statusCode: 410 };
    };
    await runReminders(f.store, config, send, due);
    expect(
      (await f.store.get<PushSubscription>("subscriptions", f.subscription.id))
        ?.active,
    ).toBe(true);
  });
  it("permits a new generation to notify while ordinary revisions keep the same delivery identity", async () => {
    const f = await fixture();
    await runReminders(f.store, config, f.send, due);
    await f.store.put("tasks", task.id, {
      ...task,
      reminderGeneration: "generation-2",
      reminderStartAt: iso(due + 1),
      at: iso(due + 120_000),
      revision: 2,
    });
    await runReminders(f.store, config, f.send, due + 120_000);
    expect(f.sent).toHaveLength(2);
    expect(new Set((await rows(f.store)).map((x) => x.id)).size).toBe(2);
  });
});

describe("independent cloud timer and web-push adapter", () => {
  it("matches the installed SDK's JSON and legacy parsed context structures", async () => {
    const sdk = createRequire(import.meta.url)("../node_modules/@cloudbase/node-sdk/dist/utils/tcbcontext.js");
    expect(sdk.parseContext({ environment: JSON.stringify({ TCB_UUID: owner, TRIGGER_SRC: "timer" }), time_limit_in_ms: 60_000 } as any)).toMatchObject({
      environment: { TCB_UUID: owner, TRIGGER_SRC: "timer" }, timeLimitIns: 60_000,
    });
    expect(sdk.parseContext({ environ: "TCB_UUID=synthetic-owner;TRIGGER_SRC=timer;LOGINTYPE=SYSTEM" } as any)).toMatchObject({
      environ: { TCB_UUID: "synthetic-owner", TRIGGER_SRC: "timer", LOGINTYPE: "SYSTEM" },
    });
    expect(() => sdk.parseContext({} as any)).toThrow();
  });
  function setupCloud() {
    vi.stubEnv("OWNER_UID", owner);
    vi.stubEnv("VAPID_PUBLIC_KEY", config.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", config.privateKey);
    vi.stubEnv("VAPID_SUBJECT", config.subject);
    vi.stubEnv("REMINDER_TRIGGER_TOKEN", "");
    const emptyQuery = {
      orderBy: () => emptyQuery,
      limit: () => emptyQuery,
      get: async () => ({ data: [] }),
    };
    cloudMock.init.mockReturnValue({
      auth: () => ({ getAuthContext: cloudMock.getAuthContext }),
      database: cloudMock.database,
    });
    cloudMock.database.mockReturnValue({
      collection: (collection: string) => ({
        ...emptyQuery,
        doc: (id: string) => ({
          get: async () => ({ data: [] }),
          set: async (value: unknown) => cloudMock.healthWrite(collection, id, value),
        }),
      }),
    });
    cloudMock.getAuthContext.mockResolvedValue({ uid: null });
    cloudMock.parseContext.mockReturnValue({ environment: {} });
    return { Type: "Timer", TriggerName: "customer-reminders" };
  }
  it("accepts the secret timer name without a Message or platform source, recording timer health", async () => {
    const event = setupCloud(), token = "abcdef01".repeat(8);
    vi.stubEnv("REMINDER_TRIGGER_TOKEN", token);
    const named = { ...event, TriggerName: "customer-reminders-" + token.slice(0, 32) };
    expect(named.TriggerName).toHaveLength(51);
    expect(isReminderTimer(named)).toBe(true);
    await expect(main(named, { environment: "{}" })).resolves.toMatchObject({ configured: true, attempted: 0 });
    expect(cloudMock.healthWrite.mock.calls[0][2]).toMatchObject({ source: "timer" });
    expect(JSON.stringify(cloudMock.healthWrite.mock.calls)).not.toContain(token.slice(0, 32));
  });
  it.each([
    "customer-reminders-" + "0".repeat(32),
    "customer-reminders-" + "a".repeat(31),
    "customer-reminders-" + "a".repeat(33),
    "customer-reminders-" + "A".repeat(32),
    "customer-reminders-extra-" + "a".repeat(32),
    "customer-remindersX-" + "a".repeat(32),
    "xcustomer-reminders-" + "a".repeat(32),
  ])("rejects wrong secret suffixes and similar prefixes: %s", async (TriggerName) => {
    const event = setupCloud();
    vi.stubEnv("REMINDER_TRIGGER_TOKEN", "abcdef01".repeat(8));
    await expect(main({ ...event, TriggerName, uid: owner, context: { TRIGGER_SRC: "timer" }, TRIGGER_SRC: "timer" }, { environment: "{}" })).rejects.toThrow();
    expect(cloudMock.database).not.toHaveBeenCalled();
    expect(cloudMock.healthWrite).not.toHaveBeenCalled();
  });
  it("rejects non-owner, system test UID and anonymous identities even with the correct secret timer name", async () => {
    const event = setupCloud(), token = "abcdef01".repeat(8);
    vi.stubEnv("REMINDER_TRIGGER_TOKEN", token);
    for (const auth of [{ uid: "intruder" }, { uid: "test_UID", loginType: "SYSTEM" }, { uid: owner, loginType: "ANONYMOUS" }]) {
      cloudMock.getAuthContext.mockResolvedValue(auth);
      await expect(main({ ...event, TriggerName: "customer-reminders-" + token.slice(0, 32) }, { environment: "{}" })).rejects.toThrow("无权执行");
    }
    cloudMock.getAuthContext.mockResolvedValue({ uid: null });
    for (const current of [{ TCB_UUID: "intruder" }, { TCB_ISANONYMOUS_USER: "true" }]) {
      cloudMock.parseContext.mockReturnValue({ environment: current });
      await expect(main({ ...event, TriggerName: "customer-reminders-" + token.slice(0, 32) }, { environment: "{}" })).rejects.toThrow("无权执行");
    }
    expect(cloudMock.database).not.toHaveBeenCalled();
    expect(cloudMock.healthWrite).not.toHaveBeenCalled();
  });
  it("rejects a forged Timer from other accounts, anonymous users and identity-free normal calls", async () => {
    const event = setupCloud(),
      platformContext = {
        environment: "{}",
        request_id: "platform",
        time_limit_in_ms: 60_000,
      };
    for (const auth of [
      { uid: "intruder" },
      { uid: null },
      { uid: "anonymous-id", loginType: "ANONYMOUS" },
      { uid: owner },
    ]) {
      cloudMock.getAuthContext.mockResolvedValue(auth);
      await expect(
        main(
          {
            ...event,
            uid: owner,
            context: { TRIGGER_SRC: "timer" },
            TRIGGER_SRC: "timer",
          },
          platformContext,
        ),
      ).rejects.toThrow("无权执行");
    }
    expect(cloudMock.getAuthContext).toHaveBeenCalledWith(platformContext);
    expect(cloudMock.database).not.toHaveBeenCalled();
    expect(cloudMock.healthWrite).not.toHaveBeenCalled();
  });
  it.each(["manual", "timer"] as const)("records only safe health fields after a verified successful %s scan", async (source) => {
    const event = setupCloud();
    vi.useFakeTimers();
    vi.setSystemTime(due);
    const token = "synthetic-server-trigger-token-0123456789";
    vi.stubEnv("REMINDER_TRIGGER_TOKEN", token);
    cloudMock.parseContext.mockReturnValue({
      environment: source === "timer" ? { TRIGGER_SRC: "timer" } : {},
    });
    await expect(main({ ...event, Message: token, TRIGGER_SRC: "timer", source: "timer", privateKey: config.privateKey }, { environment: "{}" })).resolves.toMatchObject({ configured: true, attempted: 0 });
    expect(cloudMock.healthWrite).toHaveBeenCalledExactlyOnceWith("batches", REMINDER_HEALTH_ID, {
      lastRunAt: iso(due), source,
      accepted: 0, failed: 0, cancelled: 0, retried: 0,
      unsubscribed: 0, attempted: 0, deferred: 0,
    });
  });
  it("returns private auth diagnostics without database access or health writes; uncredentialed failures still throw", async () => {
    const event = setupCloud(), token = "synthetic-server-trigger-token-0123456789";
    vi.stubEnv("REMINDER_TRIGGER_TOKEN", token);
    await expect(main({ ...event, Message: "wrong", TRIGGER_SRC: "timer" }, { environment: "{}" })).rejects.toThrow("无法验证");
    cloudMock.parseContext.mockReturnValue({ environment: { TRIGGER_SRC: "timer" } });
    for (const auth of [{ uid: "intruder" }, { uid: "test_UID", loginType: "SYSTEM" }, { uid: owner, loginType: "ANONYMOUS" }]) {
      cloudMock.getAuthContext.mockResolvedValue(auth);
      await expect(main({ ...event, Message: token }, { environment: "{}" })).resolves.toEqual({ ok: false, error: "REMINDER_AUTH_FAILED", stage: "identity" });
      await expect(main(event, { environment: "{}" })).rejects.toThrow("无权执行");
    }
    cloudMock.getAuthContext.mockRejectedValue(new Error("synthetic auth failure"));
    await expect(main({ ...event, Message: token }, { environment: "{}" })).resolves.toEqual({ ok: false, error: "REMINDER_AUTH_FAILED", stage: "auth_context" });
    expect(cloudMock.database).not.toHaveBeenCalled();
    expect(cloudMock.healthWrite).not.toHaveBeenCalled();
    cloudMock.getAuthContext.mockResolvedValue({ uid: null });
    cloudMock.database.mockReturnValue({ collection: () => { throw new Error("synthetic scan failure"); } });
    await expect(main(event, { environment: "{}" })).resolves.toEqual({ ok: false, error: "REMINDER_EXECUTION_FAILED", stage: "scan" });
    expect(cloudMock.healthWrite).not.toHaveBeenCalled();
  });
  it("records a generic verified scan failure without returning or storing SDK material", async () => {
    const event = setupCloud();
    vi.useFakeTimers(); vi.setSystemTime(due);
    cloudMock.parseContext.mockReturnValue({ environment: { TRIGGER_SRC: "timer" } });
    cloudMock.database.mockReturnValue({
      collection: (collection: string) => ({
        doc: (id: string) => ({
          get: async () => ({ data: [] }),
          set: async (value: unknown) => cloudMock.healthWrite(collection, id, value),
        }),
        orderBy() { return this; }, limit() { return this; },
        get: async () => { throw { message: config.privateKey, body: keys.auth, code: "SECRET_SDK_CODE" }; },
      }),
    });
    await expect(main(event, { environment: "{}" })).resolves.toEqual({ ok: false, error: "REMINDER_EXECUTION_FAILED", stage: "scan" });
    expect(cloudMock.healthWrite).toHaveBeenCalledExactlyOnceWith("batches", REMINDER_HEALTH_ID, {
      lastRunAt: iso(due), source: "timer", error: "REMINDER_EXECUTION_FAILED",
    });
  });
  it("returns a safe execution failure even if health persistence also fails", async () => {
    const event = setupCloud();
    cloudMock.parseContext.mockReturnValue({ environment: { TRIGGER_SRC: "timer" } });
    cloudMock.healthWrite.mockRejectedValue({ message: config.privateKey });
    await expect(main(event, { environment: "{}" })).resolves.toEqual({ ok: false, error: "REMINDER_EXECUTION_FAILED", stage: "health_write" });
    expect(cloudMock.healthWrite).toHaveBeenCalledTimes(2);
  });
  it("returns parse/initialization diagnostics only with a valid Message, without relaxing identity", async () => {
    const event = setupCloud(), token = "synthetic-server-trigger-token-0123456789";
    vi.stubEnv("REMINDER_TRIGGER_TOKEN", token);
    cloudMock.parseContext.mockImplementation(() => { throw new Error(config.privateKey); });
    await expect(main({ ...event, Message: token }, { environment: "{}" })).resolves.toEqual({ ok: false, error: "REMINDER_AUTH_FAILED", stage: "parse_context" });
    await expect(main(event, { environment: "{}" })).rejects.toThrow("无权执行");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await expect(main({ ...event, Message: token }, { environment: "{}" })).resolves.toEqual({ ok: false, error: "REMINDER_EXECUTION_FAILED", stage: "initialization" });
    expect(cloudMock.database).not.toHaveBeenCalled();
    expect(cloudMock.healthWrite).not.toHaveBeenCalled();
  });
  it("does not trust stale process source, and accepts current platform timer source only after context auth", async () => {
    const event = setupCloud(),
      context = { environment: "{}", time_limit_in_ms: 60_000 };
    vi.stubEnv("TRIGGER_SRC", "timer");
    await expect(main(event, context)).rejects.toThrow("无法验证");
    cloudMock.parseContext.mockReturnValue({
      environment: { TRIGGER_SRC: "timer" },
    });
    cloudMock.getAuthContext.mockResolvedValue({ uid: "intruder" });
    await expect(main(event, context)).rejects.toThrow("无权执行");
    cloudMock.getAuthContext.mockResolvedValue({ uid: null });
    await expect(main(event, context)).resolves.toMatchObject({
      configured: true,
      attempted: 0,
    });
  });
  it("supports a secret timer Message when platform source is absent, fails closed on auth errors", async () => {
    const event = setupCloud(),
      token = "random-server-only-trigger-token-0123456789";
    vi.stubEnv("REMINDER_TRIGGER_TOKEN", token);
    await expect(
      main({ ...event, Message: "wrong" }, { environment: "{}" }),
    ).rejects.toThrow("无法验证");
    await expect(
      main({ ...event, Message: token }, { environment: "{}" }),
    ).resolves.toMatchObject({ attempted: 0 });
    cloudMock.getAuthContext.mockResolvedValue({ uid: "intruder" });
    await expect(
      main({ ...event, Message: token }, { environment: "{}" }),
    ).resolves.toEqual({ ok: false, error: "REMINDER_AUTH_FAILED", stage: "identity" });
    cloudMock.getAuthContext.mockRejectedValue({ message: config.privateKey });
    await expect(
      main({ ...event, Message: token }, { environment: "{}" }),
    ).resolves.toEqual({ ok: false, error: "REMINDER_AUTH_FAILED", stage: "auth_context" });
  });
  it("rejects client events and wrong timer names before SDK initialization", async () => {
    for (const event of [
      null,
      {},
      { action: "runReminders" },
      { Type: "Timer", TriggerName: "other" },
      { Type: "HTTP", TriggerName: "customer-reminders" },
    ]) {
      expect(isReminderTimer(event)).toBe(false);
      await expect(main(event)).rejects.toThrow("仅允许");
    }
    expect(
      isReminderTimer({ Type: "Timer", TriggerName: "customer-reminders" }),
    ).toBe(true);
    vi.stubEnv("OWNER_UID", "");
    await expect(
      main({ Type: "Timer", TriggerName: "customer-reminders" }),
    ).rejects.toThrow("尚未绑定");
    vi.stubEnv("OWNER_UID", owner);
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await expect(
      main({ Type: "Timer", TriggerName: "customer-reminders" }),
    ).rejects.toThrow("尚未配置");
  });
  it("sets timeout10sec and TTL600, per-call VAPID, minimal payload and sanitized errors", async () => {
    const f = await fixture(),
      adapter = webPushSender(config);
    mockSendNotification.mockResolvedValueOnce({
      statusCode: 201,
      headers: { sensitive: "hidden" },
    });
    expect(
      await adapter(f.subscription, { taskId: task.id, tag: "stable" }),
    ).toEqual({ statusCode: 201 });
    const [s, body, options] = mockSendNotification.mock.calls[0];
    expect(s).toEqual({ endpoint: f.subscription.endpoint, keys });
    expect(JSON.parse(body)).toEqual({ taskId: task.id, tag: "stable" });
    expect(options).toMatchObject({
      timeout: 10_000,
      TTL: 600,
      vapidDetails: {
        publicKey: config.publicKey,
        privateKey: config.privateKey,
        subject: config.subject,
      },
    });
    mockSendNotification.mockRejectedValueOnce({
      statusCode: 403,
      body: config.privateKey,
      message: f.subscription.endpoint,
      headers: keys,
    });
    const failure = await adapter(f.subscription, {
      taskId: "",
      tag: "teststable",
    }).catch((x) => x);
    expect(failure).toMatchObject({ statusCode: 403, code: "push_forbidden" });
    expect(JSON.stringify(failure)).not.toContain(config.privateKey);
    expect(String(failure)).not.toContain(f.subscription.endpoint);
    mockSendNotification.mockResolvedValueOnce({
      statusCode: 302,
      headers: { location: "https://127.0.0.1/" },
    });
    await expect(
      adapter(f.subscription, { taskId: "", tag: "teststable" }),
    ).rejects.toMatchObject({ statusCode: 302, code: "push_rejected" });
    expect(mockSendNotification).toHaveBeenCalledTimes(3);
  });
});

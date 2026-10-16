import { useEffect, useState } from "react";
import { Bell, BellOff, Monitor, Smartphone } from "lucide-react";
import type { Api } from "../domain/model";
import { ErrorNote, message } from "./ui";
import {
  isAppleMobile,
  localPushReady,
  pushAvailable,
  pushDevice,
  standalone,
  startPush,
  stopPush,
  testLocalNotification,
} from "../lib/notifications";

export function PushSettings({ api, demo }: { api: Api; demo: boolean }) {
  const [state, setState] = useState<{
    configured: boolean;
    active: boolean;
    lastError?: string;
    lastAcceptedAt?: string;
    schedulerLastRunAt?: string;
    schedulerSource?: "timer" | "manual";
    schedulerError?: "REMINDER_EXECUTION_FAILED";
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [localReady, setLocalReady] = useState(false);
  const appleMobile = isAppleMobile();
  const supported = pushAvailable();
  const allowed = supported && Notification.permission === "granted";
  useEffect(() => {
    if (demo) return;
    let alive = true;
    async function refresh() {
      try {
        const [remote, local] = await Promise.all([
          api.call<NonNullable<typeof state>>("push.status", {
            id: pushDevice(),
          }),
          localPushReady(),
        ]);
        if (alive) {
          setState(remote);
          setLocalReady(local);
        }
      } catch (e) {
        if (alive) setError(message(e));
      }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
    };
  }, [api, demo, version]);
  async function action(kind: "enable" | "disable" | "test" | "local") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (kind === "enable") {
        await startPush(api);
        setNotice(
          "此设备已登记推送，请发送测试通知并确认本设备收到。手机和电脑需分别开启一次。",
        );
      }
      if (kind === "local") {
        await testLocalNotification();
        setNotice(
          "已请求显示本机通知。若没有看到，请检查电脑通知中心、浏览器的系统通知开关及勿扰模式。本机自检通过仍需发送云端测试通知。",
        );
      }
      if (kind === "disable") {
        await stopPush(api);
        setNotice("此设备已关闭推送提醒。");
      }
      if (kind === "test") {
        await api.call("push.test", { id: pushDevice() });
        setNotice(
          "测试通知已提交推送服务，请在本设备通知中心确认收到。提交成功不代表已送达；电脑未显示时可先运行本机通知自检。",
        );
      }
      setVersion((v) => v + 1);
    } catch (e) {
      setError(message(e));
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel push-settings">
      <div className="panel-heading">
        <div>
          <h2>
            <Bell size={19} /> 日程提醒
          </h2>
          <p>提前 15 分钟和到点提醒，在每条日程中可修改。</p>
        </div>
      </div>
      {appleMobile ? (
        <div className="push-guide">
          <Smartphone size={23} />
          <div>
            <strong>iPhone 安装与通知</strong>
            <p>
              使用 iOS 16.4 或更新版本。用 Safari 打开本网站 → 分享 →
              添加到主屏幕 → 从主屏幕图标打开并登录 → 点击“开启此设备提醒”。
            </p>
          </div>
        </div>
      ) : (
        <div className="push-guide">
          <Monitor size={23} />
          <div>
            <strong>电脑浏览器通知</strong>
            <p>
              在 Edge、Chrome 或 Firefox
              中点击“开启此设备提醒”，允许网站通知，再发送测试通知。电脑与
              iPhone 需要分别开启；电脑无需添加到主屏幕。
            </p>
            <p>
              若已允许但看不到通知，请检查系统通知中心、浏览器的系统通知开关和勿扰模式。Chrome
              还需网络能够连接 Google 推送服务。
            </p>
          </div>
        </div>
      )}
      <p className="subtle">
        {demo
          ? "演示账本不发送系统通知。"
          : !supported
            ? "当前浏览器不支持推送，请用独立的 Edge、Chrome 或 Firefox；iPhone 请从主屏幕应用打开。"
            : !state
              ? "正在检查此设备提醒状态…"
              : !state.configured
                ? "后台推送尚未连接。"
                : state.active && allowed && localReady
                  ? "此设备已登记，浏览器订阅与通知权限正常；请用测试通知确认实际送达。"
                  : "此设备未启用系统提醒，或浏览器订阅已失效，请点击开启重新登记。"}
      </p>
      {!demo && supported && (
        <p className="subtle">
          通知权限：
          {Notification.permission === "granted"
            ? "已允许"
            : Notification.permission === "denied"
              ? "已阻止，请在地址栏的网站权限中允许通知"
              : "尚未授权"}{" "}
          · 浏览器订阅：{localReady ? "已建立" : "未建立"} · 云端登记：
          {state?.active ? "已登记" : "未登记"}
        </p>
      )}
      {!demo && state?.schedulerError && (
        <ErrorNote>
          提醒后台最近执行失败，请检查后台配置。
          {state.schedulerSource === "manual"
            ? "本次为手动测试，尚未验证定时后台。"
            : "本次为定时调用，扫描未成功。"}
        </ErrorNote>
      )}
      {!demo && !state?.schedulerError && (
        <p className="subtle">
          {state?.schedulerSource === "timer" && state.schedulerLastRunAt
            ? `最新定时扫描时间：${new Date(state.schedulerLastRunAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）。扫描成功不代表通知已送达。`
            : "尚未验证定时后台。手动扫描和设备测试通知不代表定时器已运行。"}
        </p>
      )}
      {!demo && appleMobile && !standalone() && (
        <p className="subtle">
          苹果手机需从主屏幕应用开启通知；普通 Safari 标签页无法订阅。
        </p>
      )}
      <div className="form-actions">
        <button
          className="button primary"
          disabled={demo || busy || !supported}
          onClick={() => void action("enable")}
        >
          <Bell size={16} />
          {busy ? "处理中…" : "开启此设备提醒"}
        </button>
        <button
          className="button secondary"
          disabled={demo || busy || !state?.active || !allowed || !localReady}
          onClick={() => void action("test")}
        >
          发送测试通知
        </button>
        <button
          className="button secondary"
          disabled={demo || busy || !allowed}
          onClick={() => void action("local")}
        >
          本机通知自检
        </button>
        <button
          className="text-button"
          disabled={demo || busy || !pushDevice()}
          onClick={() => void action("disable")}
        >
          <BellOff size={16} />
          关闭此设备提醒
        </button>
      </div>
      {state?.lastError && (
        <ErrorNote>
          {(
            {
              subscription_expired: "此设备订阅已过期，请重新开启提醒。",
              push_forbidden: "推送服务拒绝请求，请重新开启提醒后测试。",
              push_network_error: "云端无法连接此设备的推送服务，请稍后重试。",
              push_unavailable: "推送服务暂时不可用，请稍后重试。",
              push_rate_limited: "推送服务请求过多，请稍后重试。",
            } as Record<string, string>
          )[state.lastError] || "此设备最近发送失败，请重新开启提醒并测试。"}
        </ErrorNote>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && (
        <p role="status" className="push-notice">
          {notice}
        </p>
      )}
      <small className="subtle">
        锁屏通知只显示通用待办提示；客户与反馈登录后查看。网络和专注模式可能影响送达。
      </small>
    </section>
  );
}

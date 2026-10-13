import { useEffect, useState } from "react";
import { Bell, BellOff, Smartphone } from "lucide-react";
import type { Api } from "../domain/model";
import { ErrorNote, message } from "./ui";
import { pushAvailable, pushDevice, standalone, startPush, stopPush } from "../lib/notifications";

export function PushSettings({ api, demo }: { api: Api; demo: boolean }) {
  const [state, setState] = useState<{ configured: boolean; active: boolean; lastError?: string; lastAcceptedAt?: string; schedulerLastRunAt?: string; schedulerSource?: "timer" | "manual"; schedulerError?: "REMINDER_EXECUTION_FAILED" }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const supported = pushAvailable();
  const allowed = supported && Notification.permission === "granted";
  useEffect(() => {
    if (demo) return;
    let alive = true;
    api.call<typeof state>("push.status", { id: pushDevice() }).then(r => { if (alive) setState(r); }).catch(e => { if (alive) setError(message(e)); });
    return () => { alive = false; };
  }, [api, demo, version]);
  async function action(kind: "enable" | "disable" | "test") {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (kind === "enable") { await startPush(api); setNotice("此设备已登记推送，请发送测试通知并确认手机收到。"); }
      if (kind === "disable") { await stopPush(api); setNotice("此设备已关闭推送提醒。"); }
      if (kind === "test") {
        await api.call("push.test", { id: pushDevice() });
        setNotice("测试通知已提交推送服务，请在手机通知中心确认收到。提交成功不代表手机已送达。");
      }
      setVersion(v => v + 1);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <section className="panel push-settings">
    <div className="panel-heading"><div><h2><Bell size={19} /> 日程提醒</h2><p>提前 15 分钟和到点提醒，在每条日程中可修改。</p></div></div>
    <div className="push-guide"><Smartphone size={23} /><div><strong>iPhone 安装与通知</strong><p>使用 iOS 16.4 或更新版本。用 Safari 打开本网站 → 分享 → 添加到主屏幕 → 从主屏幕图标打开并登录 → 点击“开启此设备提醒”。</p></div></div>
    <p className="subtle">{demo ? "演示账本不发送系统通知。" : !supported ? "当前浏览器不支持推送，请使用支持的主屏幕应用。" : !state?.configured ? "后台推送尚未连接。" : state.active && allowed ? "此设备已登记，通知权限已允许；请用测试通知确认实际送达。" : "此设备未启用系统提醒。"}</p>
    {!demo && state?.schedulerError && <ErrorNote>提醒后台最近执行失败，请检查后台配置。{state.schedulerSource === "manual" ? "本次为手动测试，尚未验证定时后台。" : "本次为定时调用，扫描未成功。"}</ErrorNote>}
    {!demo && !state?.schedulerError && <p className="subtle">{state?.schedulerSource === "timer" && state.schedulerLastRunAt
      ? `最新定时扫描时间：${new Date(state.schedulerLastRunAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）。扫描成功不代表通知已送达。`
      : "尚未验证定时后台。手动扫描和设备测试通知不代表定时器已运行。"}</p>}
    {!demo && !standalone() && <p className="subtle">苹果手机需从主屏幕应用开启通知；普通 Safari 标签页无法订阅。</p>}
    <div className="form-actions"><button className="button primary" disabled={demo || busy || !supported} onClick={() => void action("enable")}><Bell size={16} />{busy ? "处理中…" : "开启此设备提醒"}</button><button className="button secondary" disabled={demo || busy || !state?.active || !allowed} onClick={() => void action("test")}>发送测试通知</button><button className="text-button" disabled={demo || busy || !pushDevice()} onClick={() => void action("disable")}><BellOff size={16} />关闭此设备提醒</button></div>
    {state?.lastError && <ErrorNote>{state.lastError}</ErrorNote>}
    {error && <ErrorNote>{error}</ErrorNote>}
    {notice && <p role="status" className="push-notice">{notice}</p>}
    <small className="subtle">锁屏通知只显示通用待办提示；客户与反馈登录后查看。网络和专注模式可能影响送达。</small>
  </section>;
}

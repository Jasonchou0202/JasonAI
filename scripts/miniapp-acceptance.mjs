// 小程序全量对照验收（第 3 批写好，等三批合在一起后再跑）。
// 用法：npm run build:server && node scripts/miniapp-acceptance.mjs [--batch=1|2|3|all] [--md]
// 自动部分：按方案第 4 节对照表逐行核对「页面在 app.json 里、四件套齐全、页面里真的调用了对应的云端动作」，
// 再核对包体积（主包、每个分包 < 2MB，总计 < 30MB）。真机部分写在 docs/miniapp-acceptance.md，逐条人工打勾。
// 只读：不连云端、不读 private-data、不改任何文件（--md 只打印到屏幕）。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "miniprogram";
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const want = arg("batch", "all");

// 对照表 36 行（方案第 4 节）：动作 = 小程序代码里必须出现的云端调用（任一页面里出现即可）
// any: 至少出现其中一个；all: 全部出现。web: 只在网页做（小程序不要求）
export const ROWS = [
  { no: "1", name: "登录（openid + 绑定码）", batch: 1, all: ["miniapp.me", "miniapp.owner.redeem"] },
  { no: "2", name: "加入团队（申请 → 批准）", batch: 1, all: ["miniapp.apply"] },
  { no: "3", name: "生意看板", batch: 1, all: ["dashboard"] },
  { no: "3a", name: "利润目标图", batch: 1, any: ["dashboard", "sales.list"] },
  { no: "3b", name: "月度图、需求占比", batch: 2, any: ["dashboard", "sales.list"] },
  { no: "3c", name: "四象限", batch: 2, any: ["export", "sales.list"] },
  { no: "3d", name: "客户排行", batch: 1, all: ["customers.ranking"] },
  { no: "3e", name: "报销十日分布", batch: 2, all: ["expenses.shares"] },
  { no: "3f", name: "铃铛：今日未完成日程", batch: 1, all: ["tasks.list"] },
  { no: "4", name: "记一笔", batch: 1, all: ["sales.create", "products.list"], any: ["customers.suggestions", "customers.list"] },
  { no: "5", name: "销售明细（筛选、编辑、删除）", batch: 1, all: ["sales.list", "sales.update", "sales.delete"] },
  { no: "5a", name: "回收站", batch: 2, all: ["sales.restore", "sales.purge"] },
  { no: "5b", name: "导出 CSV（发到聊天）", batch: 2, all: ["export"] },
  { no: "6", name: "客户日程", batch: 1, all: ["tasks.list", "tasks.create", "tasks.complete", "tasks.reopen", "tasks.delete", "tasks.restore"] },
  { no: "6a", name: "日程归属、认领、成员颜色", batch: 2, all: ["tasks.claim", "tasks.assign"] },
  { no: "6b", name: "iPhone 提醒事项同步", batch: 0, web: true },
  { no: "7", name: "客户详情、合并、别名", batch: 2, all: ["customers.detail", "customers.merge", "customers.unmerge", "customers.profile.save"] },
  { no: "8", name: "报销记账", batch: 2, all: ["expenses.list", "expenses.meta"] },
  { no: "8a", name: "报销记一笔、待确认、分类", batch: 2, all: ["expenses.create", "expenses.confirm", "expenses.categories.create"] },
  { no: "8b", name: "报销凭证上传/查看", batch: 2, all: ["expenses.receipts.urls"], any: ["expenses.receipts.upload", "miniapp.files.chunk"] },
  { no: "8c", name: "续费提醒按钮", batch: 2, all: ["expenses.renew"] },
  { no: "9", name: "开票", batch: 2, all: ["invoices.list", "invoices.update", "invoices.toggle", "invoices.profile.get", "invoices.profile.save"] },
  { no: "9a", name: "开票资料上传", batch: 2, all: ["invoices.files.urls"], any: ["invoices.files.upload", "miniapp.files.chunk"] },
  { no: "10", name: "常用商品、商品清理", batch: 2, all: ["products.catalog", "catalog.cleanup.preview", "catalog.cleanup"] },
  { no: "10a", name: "导入飞书历史 Excel", batch: 3, all: ["miniapp.import.preview", "miniapp.import.commit"], pages: ["pkg-settings/import/index"] },
  { no: "10b", name: "完整备份 / 从备份恢复", batch: 3, all: ["miniapp.backup.export", "miniapp.backup.restore"], pages: ["pkg-settings/backup/index"] },
  { no: "10c", name: "推送设置 → 微信服务通知", batch: 3, all: ["miniapp.subscribe.config", "miniapp.subscribe.record"], pages: ["pkg-settings/notify/index"] },
  { no: "11", name: "成员管理 + 小程序申请", batch: 1, all: ["miniapp.apply.list", "miniapp.apply.approve", "miniapp.apply.reject", "miniapp.apply.block"] },
  { no: "11b", name: "成员管理（停用、颜色、邀请码）", batch: 2, all: ["members.list", "members.disable", "members.enable", "members.invite.create"] },
  { no: "11a", name: "头像", batch: 3, all: ["members.avatar.set", "members.avatar.clear"], pages: ["pkg-settings/avatar/index"] },
  { no: "12", name: "操作日志 / 我的操作记录", batch: 2, all: ["audit.list"] },
  { no: "13", name: "内容生产：今日获客录入", batch: 3, all: ["content.daily.get", "content.daily.save", "content.daily.list"], pages: ["pkg-content/entry/index"] },
  { no: "13a", name: "内容闭环看板（只读版）", batch: 3, all: ["miniapp.content.board"], pages: ["pkg-content/board/index"] },
  { no: "14", name: "个人私密账本（标识、截屏遮盖）", batch: 1, text: ["个人私密账本", "setVisualEffectOnCapture"] },
  { no: "15", name: "提醒：服务通知（铃铛见 3f）", batch: 3, all: ["miniapp.subscribe.record"], text: ["requestSubscribeMessage"] },
  { no: "16", name: "示例数据", batch: 3, pages: ["pkg-demo/index/index"], text: ["enterDemo", "exitDemo"] },
  { no: "17", name: "刷新、版本更新提示", batch: 1, text: ["onPullDownRefresh", "getUpdateManager"] },
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const app = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8"));
const subs = app.subpackages || app.subPackages || [];
const pages = new Set([...(app.pages || []), ...subs.flatMap((s) => s.pages.map((p) => `${s.root}/${p}`))]);
const files = walk(ROOT);
const code = files.filter((f) => /\.(js|wxml)$/.test(f) && !/\/lib\//.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
const called = (a) => new RegExp(`["'\`]${a.replace(/\./g, "\\.")}["'\`]`).test(code);

const results = ROWS.filter((r) => want === "all" || String(r.batch) === want).map((r) => {
  const miss = [];
  if (!r.web) {
    for (const a of r.all || []) if (!called(a)) miss.push(a);
    if (r.any && !r.any.some(called)) miss.push(r.any.join(" 或 "));
    for (const t of r.text || []) if (!code.includes(t)) miss.push(t);
    for (const p of r.pages || []) {
      if (!pages.has(p)) miss.push(`app.json 缺页面 ${p}`);
      for (const ext of ["js", "json", "wxml", "wxss"]) if (!existsSync(join(ROOT, `${p}.${ext}`))) miss.push(`${p}.${ext}`);
    }
  }
  return { ...r, ok: miss.length === 0, miss };
});

// 包体积：主包 = 不在任何分包根目录下的文件
const size = (list) => list.reduce((n, f) => n + statSync(f).size, 0);
const shipped = files.filter((f) => !/\/(README\.md|config\.example\.js|\.gitignore)$/.test(f) && !f.endsWith("project.private.config.json"));
const inSub = (f) => subs.find((s) => f.startsWith(join(ROOT, s.root) + "/"));
const sizes = [{ name: "主包", bytes: size(shipped.filter((f) => !inSub(f))) }, ...subs.map((s) => ({ name: `分包 ${s.root}`, bytes: size(shipped.filter((f) => inSub(f) === s)) }))];
const total = sizes.reduce((n, s) => n + s.bytes, 0);
const sizeOk = sizes.every((s) => s.bytes < 2 * 1024 * 1024) && total < 30 * 1024 * 1024;
const libsBuilt = ["pkg-settings/lib/settings-lib.js", "pkg-demo/lib/demo-lib.js"].every((f) => existsSync(join(ROOT, f)));

const line = (r) => `| ${r.no} | ${r.name} | ${r.batch || "—"} | ${r.web ? "不经过小程序（不用动）" : r.ok ? "✓ 通过" : "✗ 缺：" + r.miss.join("、")} |`;
if (process.argv.includes("--md")) {
  console.log("| # | 功能 | 批 | 自动核对 |\n|---|---|---|---|\n" + results.map(line).join("\n"));
} else {
  for (const r of results) console.log(line(r));
  for (const s of sizes) console.log(`${s.bytes < 2 * 1024 * 1024 ? "✓" : "✗"} ${s.name} ${(s.bytes / 1024).toFixed(0)}KB`);
  console.log(`${sizeOk ? "✓" : "✗"} 合计 ${(total / 1024).toFixed(0)}KB（上限 30MB）`);
  console.log(`${libsBuilt ? "✓" : "✗"} 分包库已构建（npm run build:server）`);
}
const bad = results.filter((r) => !r.ok && !r.web);
console.log(`\n${results.length - bad.length}/${results.length} 行通过` + (bad.length ? `；未通过：${bad.map((r) => r.no).join("、")}` : ""));
process.exit(bad.length || !sizeOk || !libsBuilt ? 1 : 0);

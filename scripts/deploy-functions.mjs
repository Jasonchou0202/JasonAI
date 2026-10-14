// Local deployment only. Never prints credentials or puts them in build artifacts.
import { spawnSync } from "node:child_process";
import { readFile, writeFile, access, readdir, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
const root = resolve(import.meta.dirname, "..");
const privateDir = join(root, "private-data");
const configPath = join(privateDir, "deploy-env.json");
const consoleUrl = "https://tcb.cloud.tencent.com/dev";
const build = spawnSync(
  process.execPath,
  [join(root, "scripts/build-server.mjs")],
  { cwd: root, encoding: "utf8", windowsHide: true },
);
if (build.status !== 0) throw new Error("后台构建失败，未部署");
function fallback(reason) {
  console.log(
    `${reason}\n控制台部署步骤：\n1. 打开 ${consoleUrl}，选择现有环境。\n2. sales / reminders → 函数代码 → 上传代码，分别上传 artifacts/customer-sales-function.zip 和 artifacts/customer-reminders-function.zip。\n3. 核对 OWNER_UID、VAPID 配置与 REMINDER_TRIGGER_TOKEN 保持原值。\n4. reminders 的定时触发器为每分钟：0 * * * * * *；触发器名称使用私有配置中的 token 前 32 位。\n5. 在网页设置查看最新定时扫描时间，并发送测试通知。\n也可以安装官方 CLI（npm install -g @cloudbase/cli），执行 tcb login 后重新运行 npm run deploy:functions。`,
  );
  process.exitCode = 2;
}
let cfg;
try {
  cfg = JSON.parse(await readFile(configPath, "utf8"));
} catch {
  fallback(
    "缺少 private-data/deploy-env.json，请按 docs/deploy-env.example.json 建立本机配置。没有执行云端修改。",
  );
  process.exit(2);
}
if (
  !/^[\w-]{1,128}$/.test(cfg.envId || "") ||
  !/^[a-z]+-[a-z]+$/.test(cfg.region || "ap-shanghai")
)
  throw new Error("环境配置无效");
const vars = cfg.envVariables;
if (
  !vars ||
  [
    "OWNER_UID",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
    "REMINDER_TRIGGER_TOKEN",
  ].some((key) => typeof vars[key] !== "string" || !vars[key]) ||
  !/^[a-f0-9]{64}$/.test(vars.REMINDER_TRIGGER_TOKEN)
)
  throw new Error("部署配置缺少本人身份或提醒配置；保留原值，不生成新密钥。");
const secrets = [
  ...Object.values(vars),
  vars.REMINDER_TRIGGER_TOKEN.slice(0, 32),
]
  .filter((v) => typeof v === "string" && v.length > 5)
  .sort((a, b) => b.length - a.length);
const clean = (value) =>
  secrets.reduce(
    (text, secret) => text.replaceAll(secret, "[已隐藏]"),
    String(value),
  );
// Find the official CLI package locally, including the npm-exec cache. Do not download here.
const candidates = [];
if (cfg.cliEntry) candidates.push(resolve(root, cfg.cliEntry));
const packageDirs = [
  join(root, "node_modules/@cloudbase/cli"),
  join(root, "artifacts/deploy-tools/node_modules/@cloudbase/cli"),
  join(homedir(), "AppData/Roaming/npm/node_modules/@cloudbase/cli"),
];
try {
  const cache = join(
    process.env.npm_config_cache || join(homedir(), "AppData/Local/npm-cache"),
    "_npx",
  );
  for (const item of await readdir(cache))
    packageDirs.push(join(cache, item, "node_modules/@cloudbase/cli"));
} catch {}
for (const folder of packageDirs) {
  try {
    const pkg = JSON.parse(
      await readFile(join(folder, "package.json"), "utf8"),
    );
    if (pkg.name !== "@cloudbase/cli") continue;
    const bin =
      typeof pkg.bin === "string"
        ? pkg.bin
        : pkg.bin?.tcb || pkg.bin?.cloudbase;
    if (bin) candidates.push(join(folder, bin));
  } catch {}
}
let cli;
for (const path of candidates) {
  try {
    await access(path);
    cli = path;
    break;
  } catch {}
}
if (!cli) {
  fallback("未找到已安装的 CloudBase CLI。没有执行云端修改。");
  process.exit(2);
}
function call(args, timeout = 120000) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    status: result.status,
    text: (result.stdout || "") + (result.stderr || ""),
  };
}
const auth = call([
  "env",
  "list",
  "--json",
  "--region",
  cfg.region || "ap-shanghai",
]);
if (auth.status !== 0) {
  fallback("CloudBase CLI 尚未登录或登录状态不可用。没有执行云端修改。");
  process.exit(2);
}
if (!auth.text.includes(cfg.envId))
  throw new Error("当前 CLI 账号没有列出指定环境，已停止部署。");
await mkdir(privateDir, { recursive: true });
const triggerName =
  "customer-reminders-" + vars.REMINDER_TRIGGER_TOKEN.slice(0, 32);
const generated = join(privateDir, "cloudbaserc.generated.json");
await writeFile(
  generated,
  JSON.stringify(
    {
      version: "2.0",
      envId: cfg.envId,
      region: cfg.region || "ap-shanghai",
      functionRoot: join(root, "cloudfunctions"),
      functions: ["sales", "reminders"].map((name) => ({
        name,
        runtime: "Nodejs20.19",
        timeout: 60,
        memorySize: 256,
        handler: "index.main",
        installDependency: false,
        envVariables: vars,
        ...(name === "reminders"
          ? {
              triggers: [
                { name: triggerName, type: "timer", config: "0 * * * * * *" },
              ],
            }
          : {}),
      })),
    },
    null,
    2,
  ),
);
if (process.argv.includes("--check")) {
  console.log("CLI 已登录，部署配置检查通过。尚未修改云端。");
  process.exit(0);
}
for (const name of ["sales", "reminders"]) {
  const result = call(
    [
      "fn",
      "deploy",
      name,
      "--force",
      "--install-dependency",
      "false",
      "--config-file",
      generated,
    ],
    300000,
  );
  if (result.status !== 0) {
    console.error(clean(result.text));
    throw new Error(`${name} 部署失败，后续操作停止`);
  }
  console.log(`${name} 代码与环境配置已部署。`);
}
const timer = call([
  "fn",
  "trigger",
  "create",
  "reminders",
  "--trigger-name",
  triggerName,
  "--cron",
  "0 * * * * * *",
  "--config-file",
  generated,
]);
if (
  timer.status !== 0 &&
  !/already exists|ResourceInUse|已存在|重复/.test(timer.text)
) {
  console.error(clean(timer.text));
  throw new Error("分钟触发器配置未完成，请查看控制台");
}
console.log(
  "两套云函数及每分钟提醒触发器部署完成，请继续执行线上对账及手机通知回归。",
);

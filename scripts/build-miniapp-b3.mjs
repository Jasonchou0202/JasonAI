// 小程序第 3 批的构建（由 build-server.mjs 末尾调用）：
// 1) reminders 小程序版入口 → cloudfunctions/reminders-miniapp/（原 reminders 包不动，verify-sales-bundles 照旧逐字节核对）
// 2) 小程序分包库：pkg-settings/lib/settings-lib.js（读 Excel、备份压缩）、pkg-demo/lib/demo-lib.js（示例数据）
import { build } from "esbuild";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { zipSync } from "fflate";
import { resolve } from "node:path";

const alias = {
  "lodash.set": resolve("vendor/lodash-set/index.cjs"),
  "lodash.unset": resolve("vendor/lodash-unset/index.cjs"),
};
await mkdir("cloudfunctions/reminders-miniapp", { recursive: true });
await build({
  entryPoints: ["server/reminder-cloud-miniapp.ts"],
  outfile: "cloudfunctions/reminders-miniapp/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  logLevel: "warning",
  alias,
});
await writeFile(
  "cloudfunctions/reminders-miniapp/package.json",
  JSON.stringify({ name: "zhangyuge-reminders-function", version: "1.0.0", private: true, main: "index.js" }, null, 2) + "\n",
);
// 云调用发订阅消息需要声明 openapi 权限（不需要 AppSecret）
await writeFile(
  "cloudfunctions/reminders-miniapp/config.json",
  JSON.stringify({ permissions: { openapi: ["subscribeMessage.send"] } }, null, 2) + "\n",
);
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/customer-reminders-miniapp-function.zip",
  zipSync({
    "index.js": new Uint8Array(await readFile("cloudfunctions/reminders-miniapp/index.js")),
    "package.json": new Uint8Array(await readFile("cloudfunctions/reminders-miniapp/package.json")),
    "config.json": new Uint8Array(await readFile("cloudfunctions/reminders-miniapp/config.json")),
  }),
);

const mini = (entry, outfile) =>
  build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "browser",
    format: "cjs",
    target: "es2018",
    minify: true,
    legalComments: "none",
    sourcemap: false,
    logLevel: "warning",
    alias,
    define: { "import.meta.env.BASE_URL": '"/"', "process.env.NODE_ENV": '"production"' },
  });
await mini("src/miniapp-b3/settings-lib.ts", "miniprogram/pkg-settings/lib/settings-lib.js");
await mini("src/miniapp-b3/demo-lib.ts", "miniprogram/pkg-demo/lib/demo-lib.js");
for (const f of ["miniprogram/pkg-settings/lib/settings-lib.js", "miniprogram/pkg-demo/lib/demo-lib.js"]) {
  const size = (await stat(f)).size;
  // 单个分包不能超过 2MB（方案第 5 节第 9 条）；库文件留出页面的余量
  if (size > 1.5 * 1024 * 1024) throw new Error(`${f} 太大：${size}`);
  console.log(`✓ ${f} ${(size / 1024).toFixed(0)}KB`);
}

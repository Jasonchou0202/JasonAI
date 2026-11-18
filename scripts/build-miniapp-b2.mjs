// 小程序第 2 批共用计算：src/miniapp-b2/index.ts（复用 src/domain）→ miniprogram/pkg2/lib/b2.js（CommonJS，分包内用）。
// 产物进仓库（微信开发者工具直接打开目录即可用）；tests/miniapp-b2.test.ts 会核对产物和源码一致。
// 用法：node scripts/build-miniapp-b2.mjs        重新生成
//      node scripts/build-miniapp-b2.mjs --check 只核对，不一致时退出码 1
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = resolve(root, "miniprogram/pkg2/lib/b2.js");
export async function bundleB2() {
  const r = await build({
    entryPoints: [resolve(root, "src/miniapp-b2/index.ts")],
    bundle: true,
    write: false,
    platform: "neutral",
    format: "cjs",
    target: "es2017",
    inject: [resolve(root, "src/miniapp-b2/intl-inject.ts")],
    legalComments: "none",
    logLevel: "silent",
    charset: "utf8",
  });
  return "// 自动生成，勿手改：node scripts/build-miniapp-b2.mjs\n" + r.outputFiles[0].text;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await bundleB2();
  if (process.argv.includes("--check")) {
    const now = await readFile(OUT, "utf8").catch(() => "");
    if (now !== text) {
      console.error("✗ miniprogram/pkg2/lib/b2.js 和源码不一致，请运行 node scripts/build-miniapp-b2.mjs");
      process.exit(1);
    }
    console.log("✓ b2.js 和源码一致");
  } else {
    await writeFile(OUT, text);
    console.log("已生成 " + OUT + "（" + Math.round(text.length / 1024) + " KB）");
  }
}

// 把 src/miniapp/index.ts（复用 src/domain 的纯计算）编译成小程序能直接 require 的 miniprogram/lib/domain.js。
// - CommonJS、ES2017：微信基础库不用再转译也能跑。
// - inject safe-intl：安卓微信 Intl 不全时自动兜底（北京时间、千分位）。
// - 产物进仓库（小程序工程目录要能直接导入）；tests/miniapp-domain-build.test.ts 会核对它和源码同步。
// 用法：node scripts/build-miniapp.mjs（--check 只核对、不写）
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

export const OUT = "miniprogram/lib/domain.js";
export async function bundleMiniappDomain() {
  const r = await build({
    entryPoints: ["src/miniapp/index.ts"],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "neutral",
    target: "es2017",
    inject: ["src/miniapp/safe-intl.ts"],
    legalComments: "none",
    charset: "utf8",
    banner: { js: "// 自动生成，勿手改：node scripts/build-miniapp.mjs（源码 src/miniapp + src/domain）" },
    logLevel: "silent",
  });
  return r.outputFiles[0].text;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const text = await bundleMiniappDomain();
  if (process.argv.includes("--check")) {
    const old = await readFile(OUT, "utf8").catch(() => "");
    if (old !== text) {
      console.error("✗ miniprogram/lib/domain.js 和源码不同步，请运行 npm run build:miniapp");
      process.exit(1);
    }
    console.log("✓ 小程序 domain 包和源码同步");
  } else {
    await mkdir("miniprogram/lib", { recursive: true });
    await writeFile(OUT, text);
    console.log(`✓ 已生成 ${OUT}（${(text.length / 1024).toFixed(1)} KB）`);
  }
}

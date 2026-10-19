import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
import { resolve } from "node:path";
await mkdir("cloudfunctions/sales", { recursive: true });
await build({
  entryPoints: ["server/cloud.ts"],
  outfile: "cloudfunctions/sales/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: false,
  logLevel: "info",
  alias: {
    "lodash.set": resolve("vendor/lodash-set/index.cjs"),
    "lodash.unset": resolve("vendor/lodash-unset/index.cjs"),
  },
});
await writeFile(
  "cloudfunctions/sales/package.json",
  JSON.stringify(
    {
      name: "zhangyuge-sales-function",
      version: "1.0.0",
      private: true,
      main: "index.js",
    },
    null,
    2,
  ) + "\n",
);
await mkdir("cloudfunctions/reminders", { recursive: true });
await build({
  entryPoints: ["server/reminder-cloud.ts"],
  outfile: "cloudfunctions/reminders/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
  alias: {
    "lodash.set": resolve("vendor/lodash-set/index.cjs"),
    "lodash.unset": resolve("vendor/lodash-unset/index.cjs"),
  },
});
await writeFile(
  "cloudfunctions/reminders/package.json",
  JSON.stringify(
    {
      name: "zhangyuge-reminders-function",
      version: "1.0.0",
      private: true,
      main: "index.js",
    },
    null,
    2,
  ) + "\n",
);
// 只读统计函数：独立部署，不改动 sales 函数
await mkdir("cloudfunctions/sales-stats", { recursive: true });
await build({
  entryPoints: ["server/stats-cloud.ts"],
  outfile: "cloudfunctions/sales-stats/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: false,
  logLevel: "info",
  alias: {
    "lodash.set": resolve("vendor/lodash-set/index.cjs"),
    "lodash.unset": resolve("vendor/lodash-unset/index.cjs"),
  },
});
await writeFile(
  "cloudfunctions/sales-stats/package.json",
  JSON.stringify(
    {
      name: "zhangyuge-sales-stats-function",
      version: "1.0.0",
      private: true,
      main: "index.js",
    },
    null,
    2,
  ) + "\n",
);
await mkdir("artifacts", { recursive: true });
for (const name of ["sales", "reminders", "sales-stats"]) {
  const entries = Object.fromEntries(
    await Promise.all(
      ["index.js", "package.json"].map(async (file) => [
        file,
        new Uint8Array(await readFile(`cloudfunctions/${name}/${file}`)),
      ]),
    ),
  );
  await writeFile(`artifacts/customer-${name}-function.zip`, zipSync(entries));
}
// 内容获客 content 云函数：独立入口、独立打包，和上面的 sales / reminders 互不影响
await mkdir("cloudfunctions/content", { recursive: true });
await build({
  entryPoints: ["server/content-cloud.ts"],
  outfile: "cloudfunctions/content/index.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: false,
  logLevel: "info",
  alias: {
    "lodash.set": resolve("vendor/lodash-set/index.cjs"),
    "lodash.unset": resolve("vendor/lodash-unset/index.cjs"),
  },
});
await writeFile(
  "cloudfunctions/content/package.json",
  JSON.stringify(
    {
      name: "zhangyuge-content-function",
      version: "1.0.0",
      private: true,
      main: "index.js",
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  "artifacts/customer-content-function.zip",
  zipSync({
    "index.js": new Uint8Array(await readFile("cloudfunctions/content/index.js")),
    "package.json": new Uint8Array(
      await readFile("cloudfunctions/content/package.json"),
    ),
  }),
);

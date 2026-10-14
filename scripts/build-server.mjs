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
await mkdir("artifacts", { recursive: true });
for (const name of ["sales", "reminders"]) {
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

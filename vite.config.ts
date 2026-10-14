import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
let outputDir = resolve("dist");
export default defineConfig({
  plugins: [
    react(),
    {
      name: "public-shell-cache",
      configResolved(config) {
        outputDir = resolve(config.root, config.build.outDir);
      },
      async closeBundle() {
        const assets = (await readdir(resolve(outputDir, "assets")))
          .filter((f) => /\.(js|css|woff2)$/.test(f))
          .sort();
        const shell = [
          "/JasonAI/",
          "/JasonAI/index.html",
          "/JasonAI/octopus.svg",
          "/JasonAI/icon-192.png",
          "/JasonAI/icon-512.png",
          ...assets.map((f) => `/JasonAI/assets/${f}`),
        ];
        const version = createHash("sha256")
          .update(await readFile(resolve(outputDir, "index.html")))
          .update(JSON.stringify(shell))
          .digest("hex")
          .slice(0, 16);
        const sw = await readFile("public/sw.js", "utf8");
        await writeFile(
          resolve(outputDir, "sw.js"),
          sw
            .replace("__BUILD_VERSION__", version)
            .replace(
              /\/\*__SHELL_FILES__\*\/ \[[^;]*\]/,
              JSON.stringify(shell),
            ),
        );
      },
    },
  ],
  base: "/JasonAI/",
  resolve: {
    alias: {
      "lodash.set": resolve("vendor/lodash-set/index.cjs"),
      "lodash.unset": resolve("vendor/lodash-unset/index.cjs"),
    },
  },
  build: { sourcemap: false },
  server: { port: 5173, strictPort: true },
});

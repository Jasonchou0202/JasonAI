import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [react()],
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

import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      "main/index": "src/main/index.ts",
      "preload/index": "src/preload/index.ts",
    },
    format: ["cjs"],
    platform: "node",
    target: "node22",
    outDir: "dist-electron",
    clean: true,
    sourcemap: true,
    splitting: false,
    external: ["electron"],
    outExtension() {
      return {
        js: ".cjs",
      };
    },
  },
]);

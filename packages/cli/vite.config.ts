import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    clean: true,
    dts: true,
    entry: {
      index: "./src/index.ts",
      cli: "./src/cli.ts",
    },
    format: ["esm"],
    outDir: "./dist",
    platform: "node",
    target: "node18",
    sourcemap: false,
    treeshake: true,
  },
});

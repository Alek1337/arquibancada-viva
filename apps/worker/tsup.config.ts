import { defineConfig } from "tsup";

export default defineConfig({
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  bundle: true,
  clean: true,
  entry: ["src/main.ts"],
  format: ["esm"],
  keepNames: true,
  noExternal: [/^@arquibancada-viva\//u],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node24",
});

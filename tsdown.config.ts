import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node22.12",
  // Match package.json's "exports": "./dist/index.js" — tsdown defaults to a
  // fixed .mjs/.cjs extension when platform is "node" (the default here),
  // which would leave dist/index.js missing entirely.
  fixedExtension: false,
});

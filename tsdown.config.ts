import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node22.13",
  // Match package.json's "exports": "./dist/index.js" — tsdown defaults to a
  // fixed .mjs/.cjs extension when platform is "node" (the default here),
  // which would leave dist/index.js missing entirely.
  fixedExtension: false,
  // esquery is a real runtime dependency (package.json "dependencies"), not something to
  // inline: bundling it would drop the BSD-3-Clause (esquery) / BSD-2-Clause (estraverse)
  // attribution notices those licenses require on redistribution, and would hide ~40KB of
  // third-party code from SBOM/license/CVE tooling that only reads package.json.
  deps: { neverBundle: ["esquery"] },
});

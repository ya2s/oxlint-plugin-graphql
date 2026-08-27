import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { configs as ConfigsShape } from "../src/configs/index.js";

// Imports the *built* dist/index.js at runtime, not ../src/configs/index.ts: Node has no
// mechanism to resolve a .js specifier to a .ts source (that's a tsc-only convention), so this
// only works after tsdown has produced dist/. The build script runs tsdown first, this second.
//
// The specifier is built at runtime (not written as a static string literal import) so that
// `tsc --noEmit` -- which must pass on a clean checkout, before dist/ exists -- doesn't try to
// resolve dist/index.js as a module and fail. The `import type` above supplies the static type
// instead, from source.
const distEntryUrl = new URL("../dist/index.js", import.meta.url).href;
const { configs } = (await import(distEntryUrl)) as { configs: typeof ConfigsShape };

const outDir = join(process.cwd(), "dist", "configs");
mkdirSync(outDir, { recursive: true });

for (const [name, config] of Object.entries(configs)) {
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(config, null, 2)}\n`);
}

console.log(`wrote ${Object.keys(configs).length} config files to ${outDir}`);

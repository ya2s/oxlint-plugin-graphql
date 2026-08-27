import { definePlugin } from "@oxlint/plugins";
import { PLUGIN_NAME } from "./meta.js";
import { rules } from "./rules.js";

const plugin = definePlugin({
  meta: { name: PLUGIN_NAME },
  rules,
});

export default plugin;
export { rules };

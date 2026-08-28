import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["dist/**", "**/fixtures/**", "conformance/last-run-report.txt"],
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "conformance/**/*.test.ts"],
    testTimeout: 60_000,
  },
});

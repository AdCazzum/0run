import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // testTimeout bumped: storage.test.ts exercises the real 3-attempt upload
  // backoff (2s+4s+6s ≈ 12s), which the brief's retry loop runs unconditionally
  // even after the final failed attempt. See task-7-report.md.
  test: { environment: "node", testTimeout: 20000 },
});

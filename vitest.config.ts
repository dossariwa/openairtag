import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "@convex": path.resolve(__dirname, "convex") } },
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node" },
});

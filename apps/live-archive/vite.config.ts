import { defineConfig } from "vite";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
} as import("vitest/config").UserConfig);

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(projectRoot, "./"),
      // `server-only` is a runtime marker that throws unless the bundler
      // sets the react-server export condition (Next does; vitest's node
      // env doesn't). Map it to the package's own no-op so modules that
      // pull it in transitively stay testable.
      "server-only": resolve(projectRoot, "./node_modules/server-only/empty.js")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    clearMocks: true
  }
});

import { defineConfig } from "vitest/config";
import path from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Loads .env so DATABASE_URL is available to the tests that hit Postgres.
    setupFiles: [path.resolve(root, "./tests/setup.ts")],
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      // `server-only` throws when imported outside a React Server Component.
      // That guard is doing its job in the app; under Vitest it would just
      // block testing the server modules, so it is stubbed out here.
      "server-only": path.resolve(root, "./tests/stubs/server-only.ts"),
    },
  },
});

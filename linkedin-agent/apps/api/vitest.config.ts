import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    // The suite must not depend on whether this machine has a populated .env.
    env: { SKIP_DOTENV: 'true' },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://postgres:arcdev@localhost:5432/arc_agents',
    },
  },
});

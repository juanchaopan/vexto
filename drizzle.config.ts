import { defineConfig } from 'drizzle-kit';

// Each feature defines its tables in its server layer; generated SQL scripts go to drizzle/.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/features/*/server/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});

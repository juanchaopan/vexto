import { defineConfig } from 'drizzle-kit';

// Each feature defines its tables in its server layer, and the tables several features share are
// defined in src/lib/db/schema.ts; generated SQL scripts go to drizzle/.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/features/*/server/schema.ts', './src/lib/db/schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});

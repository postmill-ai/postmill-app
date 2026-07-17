import { PostgresStore } from '@mastra/pg';

export const pStore = new PostgresStore({
  id: 'postmill-store',
  connectionString: process.env.DATABASE_URL!,
});

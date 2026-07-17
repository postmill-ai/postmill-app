import { Inngest } from 'inngest';
import { inngestSchemas } from './inngest.types';

export const inngest = new Inngest({
  id: 'postmill',
  schemas: inngestSchemas,
  // eventKey, signingKey, env, baseUrl, isDev are read from environment variables
  // automatically by the SDK. Explicitly passing them is optional.
});

export const isInngestEnabled = () =>
  process.env.USE_INNGEST === 'true' || process.env.USE_INNGEST === '1';

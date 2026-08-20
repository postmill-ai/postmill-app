import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'postmill',
  // eventKey, signingKey, env, baseUrl, isDev are read from environment variables
  // automatically by the SDK (INNGEST_DEV=1 selects dev mode). Explicitly passing
  // them is optional.
});

export const isInngestEnabled = () =>
  process.env.USE_INNGEST === 'true' || process.env.USE_INNGEST === '1';

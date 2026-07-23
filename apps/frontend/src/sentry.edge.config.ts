import { initializeSentryServer } from '@postmill-ai/react/sentry/initialize.sentry.server';

initializeSentryServer(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SENTRY_DSN);
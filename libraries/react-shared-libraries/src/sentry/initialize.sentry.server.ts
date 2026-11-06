import * as Sentry from '@sentry/nextjs';
import { makeFetchTransport } from '@sentry/browser';
import { initializeSentryBasic } from '@postmill-ai/react/sentry/initialize.sentry.next.basic';

export const initializeSentryServer = (
  environment: string,
  dsn: string,
  createTransport = makeFetchTransport
) => initializeSentryBasic(environment, dsn, {}, createTransport);

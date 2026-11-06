import * as Sentry from '@sentry/nextjs';
import { makeFetchTransport } from '@sentry/browser';
import { makeNodeTransport } from '@sentry/node';
import { initializeSentryBasic } from '@postmill-ai/react/sentry/initialize.sentry.next.basic';

export const nextServerTransportFactory = (runtime = process.env.NEXT_RUNTIME) =>
  runtime === 'nodejs' ? makeNodeTransport : makeFetchTransport;

export const initializeSentryServer = (environment: string, dsn: string) =>
  initializeSentryBasic(environment, dsn, {}, nextServerTransportFactory());

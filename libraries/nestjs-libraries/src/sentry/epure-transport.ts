import { makeMultiplexedTransport } from '@sentry/core';
import type {
  BaseTransportOptions,
  Envelope,
  Transport,
  TransportMakeRequestResponse,
} from '@sentry/core';

export type EpureTransportFactory = (options: BaseTransportOptions) => Transport;

interface EpureTransportOptions {
  sentryDsn: string;
  epureDsn?: string;
  createTransport: EpureTransportFactory;
  secondaryTimeoutMs?: number;
}

const isValidDsn = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !!url.hostname &&
      !!url.username &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
};

export const makeEpureTransport = ({
  sentryDsn,
  epureDsn,
  createTransport,
  secondaryTimeoutMs = 3000,
}: EpureTransportOptions) => {
  if (!epureDsn || !isValidDsn(epureDsn)) return undefined;
  const epureOrigin = new URL(epureDsn).origin;

  return makeMultiplexedTransport(
    (options) => {
      const transport = createTransport(options);
      if (!options.url.startsWith(epureOrigin)) return transport;
      return {
        ...transport,
        send: async (envelope: Envelope): Promise<TransportMakeRequestResponse> => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              transport.send(envelope),
              new Promise<TransportMakeRequestResponse>((resolve) => {
                timer = setTimeout(() => resolve({}), secondaryTimeoutMs);
              }),
            ]);
          } catch {
            return {};
          } finally {
            if (timer) clearTimeout(timer);
          }
        },
      };
    },
    ({ getEvent }) => (getEvent(['event']) ? [sentryDsn, epureDsn] : [sentryDsn])
  );
};

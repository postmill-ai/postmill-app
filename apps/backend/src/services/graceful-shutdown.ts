import { INestApplication, Logger } from '@nestjs/common';
import { Server } from 'node:http';

export const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;

export function createGracefulShutdown(
  app: INestApplication,
  exit: (code: number) => void = (code) => process.exit(code),
  closeWebSockets: () => void | Promise<void> = () => {},
  drainTimeoutMs = SHUTDOWN_DRAIN_TIMEOUT_MS,
) {
  let shutdownPromise: Promise<void> | undefined;

  return (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      const logger = new Logger('Bootstrap');
      logger.log(`Received ${signal}, shutting down gracefully...`);
      try {
        try {
          const server = app.getHttpServer() as Server;
          if (server.listening) {
            const httpClosed = new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
            });
            server.closeIdleConnections();

            try {
              await closeWebSockets();
            } catch (error) {
              logger.error('Error closing websocket connections', error as Error);
            }

            let drainTimer: ReturnType<typeof setTimeout> | undefined;
            try {
              const timedOut = await Promise.race([
                httpClosed.then(() => false),
                new Promise<true>((resolve) => {
                  drainTimer = setTimeout(() => resolve(true), drainTimeoutMs);
                  drainTimer.unref();
                }),
              ]);
              if (timedOut) {
                const remaining = await new Promise<number>((resolve) => {
                  server.getConnections((_error, count) => resolve(count));
                });
                logger.warn(
                  `HTTP drain exceeded ${drainTimeoutMs}ms; forcing ${remaining} remaining connection(s) closed.`,
                );
                server.closeAllConnections();
              }
            } finally {
              clearTimeout(drainTimer);
            }
          }
        } catch (error) {
          logger.error('Error draining HTTP connections', error as Error);
        }

        await app.close();
      } catch (error) {
        logger.error('Error during graceful shutdown', error as Error);
      } finally {
        exit(0);
      }
    })();

    return shutdownPromise;
  };
}

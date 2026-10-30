import { INestApplication, Logger } from '@nestjs/common';
import { Server } from 'node:http';

export function createGracefulShutdown(
  app: INestApplication,
  exit: (code: number) => void = (code) => process.exit(code),
) {
  let shutdownPromise: Promise<void> | undefined;

  return (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      const logger = new Logger('Bootstrap');
      logger.log(`Received ${signal}, shutting down gracefully...`);
      try {
        const server = app.getHttpServer() as Server;
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          });
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

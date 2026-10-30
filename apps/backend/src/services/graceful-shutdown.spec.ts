import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'node:net';
import { createServer, get } from 'node:http';
import { createGracefulShutdown } from './graceful-shutdown';

describe('createGracefulShutdown', () => {
  it('closes idle HTTP and websocket connections before draining Nest providers', async () => {
    const calls: string[] = [];
    let finishHttpClose: ((error?: Error) => void) | undefined;
    const server = {
      listening: true,
      close: vi.fn((callback: (error?: Error) => void) => {
        calls.push('http.close');
        finishHttpClose = callback;
      }),
      closeIdleConnections: vi.fn(() => {
        calls.push('http.closeIdle');
      }),
    };
    const app = {
      getHttpServer: () => server,
      close: vi.fn(async () => {
        calls.push('app.close');
      }),
    } as unknown as INestApplication;
    const exit = vi.fn();
    const closeWebSockets = vi.fn(() => {
      calls.push('websockets.close');
    });
    const shutdown = createGracefulShutdown(app, exit, closeWebSockets);

    const pending = shutdown('SIGTERM');

    expect(calls).toEqual(['http.close', 'http.closeIdle', 'websockets.close']);
    expect(app.close).not.toHaveBeenCalled();
    finishHttpClose?.();
    await pending;

    expect(calls).toEqual([
      'http.close',
      'http.closeIdle',
      'websockets.close',
      'app.close',
    ]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('runs only once when multiple signals arrive', async () => {
    const app = {
      getHttpServer: () => ({ listening: false }),
      close: vi.fn(async () => {}),
    } as unknown as INestApplication;
    const exit = vi.fn();
    const shutdown = createGracefulShutdown(app, exit);

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('force-closes a real never-ending HTTP connection and still closes Nest', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(': connected\n\n');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const request = get(`http://127.0.0.1:${port}/stream`);
    await new Promise<void>((resolve) => {
      request.once('response', () => resolve());
    });

    try {
      const app = {
        getHttpServer: () => server,
        close: vi.fn(async () => {}),
      } as unknown as INestApplication;
      const exit = vi.fn();
      const shutdown = createGracefulShutdown(app, exit, () => {}, 20);

      await shutdown('SIGTERM');

      expect(app.close).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      request.destroy();
      server.closeAllConnections();
    }
  });

  it('still exits when closing the application fails', async () => {
    const app = {
      getHttpServer: () => ({ listening: false }),
      close: vi.fn(async () => {
        throw new Error('close failed');
      }),
    } as unknown as INestApplication;
    const exit = vi.fn();
    const shutdown = createGracefulShutdown(app, exit);

    await shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledWith(0);
  });
});

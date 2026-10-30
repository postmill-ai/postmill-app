import { INestApplication } from '@nestjs/common';
import { createGracefulShutdown } from './graceful-shutdown';

describe('createGracefulShutdown', () => {
  it('drains HTTP before closing Nest providers', async () => {
    const calls: string[] = [];
    let finishHttpClose: ((error?: Error) => void) | undefined;
    const server = {
      listening: true,
      close: vi.fn((callback: (error?: Error) => void) => {
        calls.push('http.close');
        finishHttpClose = callback;
      }),
    };
    const app = {
      getHttpServer: () => server,
      close: vi.fn(async () => {
        calls.push('app.close');
      }),
    } as unknown as INestApplication;
    const exit = vi.fn();
    const shutdown = createGracefulShutdown(app, exit);

    const pending = shutdown('SIGTERM');

    expect(calls).toEqual(['http.close']);
    expect(app.close).not.toHaveBeenCalled();
    finishHttpClose?.();
    await pending;

    expect(calls).toEqual(['http.close', 'app.close']);
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

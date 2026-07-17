import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from '@gitroom/backend/services/health.service';

const safeFetchMock = vi.fn();

vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

const createMockInngestModule = (functionCount = 5) =>
  ({
    getFunctions: vi.fn().mockReturnValue(Array.from({ length: functionCount })),
  } as never);

const runRepoMock = { getAllLatest: vi.fn() };
const createMockRunRepo = () => runRepoMock as never;

const healthRepoMock = { ping: vi.fn() };
const redisMock = { ping: vi.fn() };

const createHealthService = (overrides: {
  inngestService?: any;
  runRepo?: any;
  healthRepo?: any;
  redisService?: any;
} = {}) =>
  new HealthService(
    overrides.inngestService ?? createMockInngestModule(),
    overrides.runRepo ?? createMockRunRepo(),
    overrides.healthRepo ?? healthRepoMock,
    overrides.redisService ?? redisMock
  );

const createMockHealthService = () => ({
  getLive: vi.fn().mockReturnValue({
    status: 'ok',
    timestamp: '2026-01-01T00:00:00.000Z',
  }),
  getReady: vi.fn().mockResolvedValue({
    status: 'ok',
    timestamp: '2026-01-01T00:00:00.000Z',
    dependencies: {
      database: { ok: true },
      redis: { ok: true },
    },
  }),
  getHealth: vi.fn().mockResolvedValue({
    status: 'ok',
    timestamp: '2026-01-01T00:00:00.000Z',
    inngest: { healthy: true },
  }),
});

describe('HealthService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    runRepoMock.getAllLatest.mockReset().mockResolvedValue([]);
    healthRepoMock.ping.mockReset().mockResolvedValue(undefined);
    redisMock.ping.mockReset().mockResolvedValue(undefined);
    delete process.env.USE_INNGEST;
    delete process.env.INNGEST_DEV;
    delete process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_SIGNING_KEY;
    delete process.env.INNGEST_SIGNING_KEY_FALLBACK;
    delete process.env.INNGEST_BASE_URL;

    safeFetchMock.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('getLive', () => {
    it('returns ok status and a timestamp', () => {
      const service = createHealthService();
      const result = service.getLive();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('getReady', () => {
    it('returns ok when database and redis are reachable', async () => {
      const service = createHealthService();
      const result = await service.getReady();

      expect(result.status).toBe('ok');
      expect(result.dependencies).toEqual({
        database: { ok: true },
        redis: { ok: true },
      });
      expect(result.timestamp).toBeDefined();
    });

    it('throws ServiceUnavailableException when the database ping fails', async () => {
      healthRepoMock.ping.mockRejectedValue(new Error('connection refused'));
      const service = createHealthService();

      let thrown: any;
      try {
        await service.getReady();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      expect(thrown.response).toMatchObject({
        status: 'unavailable',
        dependencies: {
          database: { ok: false, error: 'connection refused' },
          redis: { ok: true },
        },
      });
    });

    it('throws ServiceUnavailableException when the redis ping fails', async () => {
      redisMock.ping.mockRejectedValue(new Error('timeout'));
      const service = createHealthService();

      let thrown: any;
      try {
        await service.getReady();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      expect(thrown.response).toMatchObject({
        status: 'unavailable',
        dependencies: {
          database: { ok: true },
          redis: { ok: false, error: 'timeout' },
        },
      });
    });
  });

  describe('getHealth', () => {
    it('reports healthy when functions are registered and Inngest is not enabled', async () => {
      safeFetchMock.mockResolvedValue({ ok: true } as Response);

      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.status).toBe('ok');
      expect(result.inngest).toMatchObject({
        useInngest: false,
        devMode: false,
        eventKeyPresent: false,
        signingKeyPresent: false,
        signingKeyRequired: true,
        fallbackKeyPresent: false,
        serveHandlerRegistered: true,
        functionsRegistered: 5,
        eventApiReachable: true,
        healthy: true,
      });
      expect(result.timestamp).toBeDefined();
    });

    it('surfaces per-function last runs and the probe latency', async () => {
      const lastRuns = [
        {
          functionId: 'comments-collection',
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:00:01.000Z'),
          durationMs: 1000,
          status: 'completed',
        },
      ];
      runRepoMock.getAllLatest.mockResolvedValue(lastRuns);
      safeFetchMock.mockResolvedValue({ ok: true } as Response);

      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.inngest.lastRuns).toEqual(lastRuns);
      expect(typeof result.inngest.eventApiLatencyMs).toBe('number');
      expect(result.inngest.eventApiLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('reports null probe latency and empty last runs when the probe fails', async () => {
      process.env.USE_INNGEST = 'true';
      safeFetchMock.mockRejectedValue(new Error('unreachable'));

      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.inngest.eventApiLatencyMs).toBeNull();
      expect(result.inngest.lastRuns).toEqual([]);
    });

    it('reports healthy in dev mode without keys', async () => {
      process.env.INNGEST_DEV = '1';
      process.env.USE_INNGEST = 'true';
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.inngest).toMatchObject({
        useInngest: true,
        devMode: true,
        eventKeyPresent: false,
        signingKeyPresent: false,
        signingKeyRequired: false,
        serveHandlerRegistered: true,
        eventApiReachable: true,
        healthy: true,
      });
    });

    it('reports healthy in Cloud mode when both keys are present', async () => {
      process.env.USE_INNGEST = 'true';
      process.env.INNGEST_EVENT_KEY = 'test-event-key';
      process.env.INNGEST_SIGNING_KEY = 'test-signing-key';
      safeFetchMock.mockResolvedValue({ ok: true } as Response);

      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.inngest).toMatchObject({
        useInngest: true,
        devMode: false,
        eventKeyPresent: true,
        signingKeyPresent: true,
        signingKeyRequired: true,
        serveHandlerRegistered: true,
        eventApiReachable: true,
        healthy: true,
      });
    });

    it('reports unhealthy in Cloud mode when keys are missing', async () => {
      process.env.USE_INNGEST = 'true';
      safeFetchMock.mockRejectedValue(new Error('unreachable'));

      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.inngest.healthy).toBe(false);
      expect(result.inngest.signingKeyRequired).toBe(true);
    });

    it('skips signing-key validation when INNGEST_DEV=1', async () => {
      process.env.USE_INNGEST = 'true';
      process.env.INNGEST_DEV = '1';
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
      // Intentionally omit keys
      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.inngest.signingKeyRequired).toBe(false);
      expect(result.inngest.healthy).toBe(true);
    });

    it('reports fallback key presence', async () => {
      process.env.INNGEST_SIGNING_KEY_FALLBACK = 'fallback-key';
      safeFetchMock.mockRejectedValue(new Error('unreachable'));

      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.inngest.fallbackKeyPresent).toBe(true);
    });

    it('reports unhealthy when no functions are registered', async () => {
      safeFetchMock.mockRejectedValue(new Error('unreachable'));

      const service = createHealthService({
        inngestService: createMockInngestModule(0),
      });
      const result = await service.getHealth();

      expect(result.inngest.serveHandlerRegistered).toBe(false);
      expect(result.inngest.healthy).toBe(false);
    });

    it('handles getFunctions throwing gracefully', async () => {
      safeFetchMock.mockRejectedValue(new Error('unreachable'));

      const service = createHealthService({
        inngestService: {
          getFunctions: vi.fn().mockImplementation(() => {
            throw new Error('module not ready');
          }),
        },
      });
      const result = await service.getHealth();

      expect(result.inngest.serveHandlerRegistered).toBe(false);
      expect(result.inngest.functionsRegistered).toBe(0);
      expect(result.inngest.healthy).toBe(false);
    });

    it('checks Inngest Cloud event-API reachability in Cloud mode', async () => {
      process.env.USE_INNGEST = 'true';
      process.env.INNGEST_EVENT_KEY = 'test-event-key';
      process.env.INNGEST_SIGNING_KEY = 'test-signing-key';
      safeFetchMock.mockResolvedValue({ ok: true } as Response);

      const service = createHealthService();
      const result = await service.getHealth();

      expect(safeFetchMock).toHaveBeenCalledWith(
        'https://inn.gs/',
        expect.objectContaining({ method: 'HEAD', signal: expect.any(AbortSignal) })
      );
      expect(result.inngest.eventApiReachable).toBe(true);
    });

    it('reports eventApiReachable false when Inngest Cloud is unreachable', async () => {
      process.env.USE_INNGEST = 'true';
      process.env.INNGEST_EVENT_KEY = 'test-event-key';
      process.env.INNGEST_SIGNING_KEY = 'test-signing-key';
      safeFetchMock.mockRejectedValue(new Error('timeout'));

      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.inngest.eventApiReachable).toBe(false);
      expect(result.inngest.healthy).toBe(true);
    });

    it('checks dev server reachability when INNGEST_DEV=1 and reports true when reachable', async () => {
      process.env.INNGEST_DEV = '1';
      process.env.USE_INNGEST = 'true';
      process.env.INNGEST_BASE_URL = 'http://inngest-dev.test';
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const service = createHealthService();
      const result = await service.getHealth();

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'http://inngest-dev.test',
        expect.objectContaining({ method: 'HEAD', signal: expect.any(AbortSignal) })
      );
      expect(result.inngest.eventApiReachable).toBe(true);
    });

    it('falls back to localhost:8288 in dev mode when INNGEST_BASE_URL is not set', async () => {
      process.env.INNGEST_DEV = '1';
      process.env.USE_INNGEST = 'true';
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      const service = createHealthService();
      const result = await service.getHealth();

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'http://localhost:8288',
        expect.objectContaining({ method: 'HEAD', signal: expect.any(AbortSignal) })
      );
      expect(result.inngest.eventApiReachable).toBe(true);
    });

    it('reports eventApiReachable false when dev server is unreachable', async () => {
      process.env.INNGEST_DEV = '1';
      process.env.USE_INNGEST = 'true';
      vi.mocked(fetch).mockRejectedValue(new Error('connection refused'));

      const service = createHealthService();
      const result = await service.getHealth();

      expect(result.inngest.eventApiReachable).toBe(false);
      expect(result.inngest.healthy).toBe(true);
    });
  });
});

describe('HealthController', () => {
  it('delegates getLive to the health service', () => {
    const mockService = createMockHealthService();
    const controller = new HealthController(mockService as any);

    const result = controller.getLive();

    expect(mockService.getLive).toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ok',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });

  it('delegates getReady to the health service', async () => {
    const mockService = createMockHealthService();
    const controller = new HealthController(mockService as any);

    const result = await controller.getReady();

    expect(mockService.getReady).toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ok',
      timestamp: '2026-01-01T00:00:00.000Z',
      dependencies: {
        database: { ok: true },
        redis: { ok: true },
      },
    });
  });

  it('rethrows the service exception when readiness fails', async () => {
    const mockService = createMockHealthService();
    const error = new ServiceUnavailableException({
      status: 'unavailable',
      timestamp: '2026-01-01T00:00:00.000Z',
      dependencies: { database: { ok: false, error: 'down' }, redis: { ok: true } },
    });
    mockService.getReady.mockRejectedValue(error);

    const controller = new HealthController(mockService as any);

    await expect(controller.getReady()).rejects.toBe(error);
    expect(mockService.getReady).toHaveBeenCalled();
  });

  it('delegates getHealth to the health service', async () => {
    const mockService = createMockHealthService();
    const controller = new HealthController(mockService as any);

    const result = await controller.getHealth();

    expect(mockService.getHealth).toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ok',
      timestamp: '2026-01-01T00:00:00.000Z',
      inngest: { healthy: true },
    });
  });
});

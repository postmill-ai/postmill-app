import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockConnect,
  mockIdempotentMiddlewareFn,
  mockRedisAdapterConstructor,
  mockIdempotentExpress,
} = vi.hoisted(() => ({
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockIdempotentMiddlewareFn: vi.fn(),
  mockRedisAdapterConstructor: vi.fn(),
  mockIdempotentExpress: vi.fn(),
}));

vi.mock('@reaatech/idempotency-middleware-adapter-redis', () => ({
  RedisAdapter: class {
    constructor(redis: any) {
      mockRedisAdapterConstructor(redis);
    }
    connect = mockConnect;
  },
}));

vi.mock('@reaatech/idempotency-middleware-express', () => ({
  idempotentExpress: mockIdempotentExpress,
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { IdempotencyFactory } from './idempotency.factory';

function freshFactory() {
  return new IdempotencyFactory();
}

describe('IdempotencyFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockIdempotentExpress.mockReturnValue(mockIdempotentMiddlewareFn);
    // reset any persisted mock implementations from previous tests
    mockRedisAdapterConstructor.mockReset();
    mockConnect.mockReset();
  });

  afterEach(() => {
    // restore defaults for the next test
    mockConnect.mockResolvedValue(undefined);
    mockIdempotentExpress.mockReturnValue(mockIdempotentMiddlewareFn);
    mockRedisAdapterConstructor.mockImplementation((_redis: any) => { /* no-op */ });
  });

  describe('onModuleInit()', () => {
    it('creates a RedisAdapter with the ioRedis instance', async () => {
      const factory = freshFactory();
      await factory.onModuleInit();

      expect(mockRedisAdapterConstructor).toHaveBeenCalledWith(expect.any(Object));
    });

    it('calls adapter.connect()', async () => {
      const factory = freshFactory();
      await factory.onModuleInit();

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('creates idempotent middleware with correct options', async () => {
      const factory = freshFactory();
      await factory.onModuleInit();

      expect(mockIdempotentExpress).toHaveBeenCalledTimes(1);
      const [adapterArg, optionsArg] = mockIdempotentExpress.mock.calls[0];
      expect(adapterArg).toBeDefined();
      expect(optionsArg).toEqual({
        ttl: 86_400,
        errorHandler: expect.any(Function),
      });
    });

    it('sets the middleware on the instance after init', async () => {
      const factory = freshFactory();
      await factory.onModuleInit();

      expect(factory.getMiddleware()).toBe(mockIdempotentMiddlewareFn);
    });

    it('returns null from getMiddleware() before initialization', () => {
      const factory = freshFactory();
      expect(factory.getMiddleware()).toBeNull();
    });

    describe('when Redis is unavailable', () => {
      it('gracefully degrades when connect throws', async () => {
        mockConnect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const factory = freshFactory();
        await factory.onModuleInit();

        expect(factory.getMiddleware()).toBeNull();
      });

      it('gracefully degrades when adapter construction throws', async () => {
        mockRedisAdapterConstructor.mockImplementationOnce(() => {
          throw new Error('Invalid Redis config');
        });

        const factory = freshFactory();
        await factory.onModuleInit();

        expect(factory.getMiddleware()).toBeNull();
      });

      it('returns null from getMiddleware when Redis is down', async () => {
        mockConnect.mockRejectedValueOnce(new Error('Connection timeout'));

        const factory = freshFactory();
        await factory.onModuleInit();

        expect(factory.getMiddleware()).toBeNull();
      });

      it('does not call idempotentExpress when adapter fails', async () => {
        mockConnect.mockRejectedValueOnce(new Error('Redis down'));

        const factory = freshFactory();
        await factory.onModuleInit();

        expect(mockIdempotentExpress).not.toHaveBeenCalled();
      });
    });
  });

  describe('getMiddleware()', () => {
    it('returns null when not initialized', () => {
      const factory = freshFactory();
      expect(factory.getMiddleware()).toBeNull();
    });

    it('returns a function after successful init', async () => {
      const factory = freshFactory();
      await factory.onModuleInit();

      const mw = factory.getMiddleware();
      expect(mw).not.toBeNull();
      expect(typeof mw).toBe('function');
    });

    it('returns the same reference across calls', async () => {
      const factory = freshFactory();
      await factory.onModuleInit();

      const mw1 = factory.getMiddleware();
      const mw2 = factory.getMiddleware();
      expect(mw1).toBe(mw2);
    });
  });
});

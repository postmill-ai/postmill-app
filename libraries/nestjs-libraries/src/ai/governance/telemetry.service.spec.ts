import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSpan, mockTracer, mockGetTracer } = vi.hoisted(() => {
  const span = {
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  };
  const startSpanFn = vi.fn().mockReturnValue(span);
  const tracer = { startSpan: startSpanFn };
  return {
    mockSpan: span,
    mockTracer: tracer,
    mockGetTracer: vi.fn().mockReturnValue(tracer),
  };
});

const { mockProviderGetTracer } = vi.hoisted(() => ({
  mockProviderGetTracer: vi.fn(),
}));

vi.mock('@opentelemetry/api', () => ({
  trace: { getTracer: mockGetTracer },
  SpanStatusCode: { OK: 'OK', ERROR: 'ERROR' },
}));

vi.mock('@opentelemetry/sdk-trace-base', () => ({
  BasicTracerProvider: class {
    getTracer = mockProviderGetTracer;
    constructor(opts?: any) {}
  },
  BatchSpanProcessor: class {
    constructor(_exporter: any) {}
  },
}));

const { mockLoggerInfo, mockOnSpanEnd } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockOnSpanEnd: vi.fn(),
}));

vi.mock('@reaatech/a2a-reference-observability', () => ({
  createLogger: vi.fn(() => ({ info: mockLoggerInfo })),
}));
vi.mock('@reaatech/agent-budget-otel-bridge', () => ({
  SpanListener: class MockSpanListener {
    constructor(_opts?: any) {}
    onSpanEnd = mockOnSpanEnd;
  },
}));
vi.mock('@reaatech/agent-budget-engine', () => ({
  BudgetController: class MockController {
    constructor(_opts?: any) {}
  },
}));
vi.mock('@reaatech/agent-budget-spend-tracker', () => ({
  SpendStore: class MockSpendStore {},
}));

import { TelemetryService } from './telemetry.service';

function freshService() {
  return new TelemetryService();
}

describe('TelemetryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTracer.startSpan.mockReturnValue(mockSpan);
    mockGetTracer.mockReturnValue(mockTracer);
    mockProviderGetTracer.mockReturnValue(mockTracer);
  });

  describe('constructor', () => {
    it('creates a default tracer from the API', () => {
      freshService();
      expect(mockGetTracer).toHaveBeenCalledWith('postmill-ai');
    });

    it('is not configured by default', () => {
      const service = freshService();
      expect(service.isConfigured).toBe(false);
    });
  });

  describe('configure()', () => {
    it('marks as configured when valid endpoint is provided', () => {
      const service = freshService();
      service.configure({ endpoint: 'https://otel.example.com/v1/traces' });
      expect(service.isConfigured).toBe(true);
    });

    it('creates a tracer from provider when endpoint is provided', () => {
      const service = freshService();
      service.configure({ endpoint: 'https://otel.example.com/v1/traces' });
      expect(mockProviderGetTracer).toHaveBeenCalledWith('postmill-ai');
    });

    it('is a no-op when observability is null', () => {
      const service = freshService();
      service.configure(null);
      expect(service.isConfigured).toBe(false);
    });

    it('is a no-op when observability is undefined', () => {
      const service = freshService();
      service.configure(undefined);
      expect(service.isConfigured).toBe(false);
    });

    it('is a no-op when observability has no endpoint', () => {
      const service = freshService();
      service.configure({} as any);
      expect(service.isConfigured).toBe(false);
    });

    it('is a no-op when endpoint is an empty string', () => {
      const service = freshService();
      service.configure({ endpoint: '' });
      expect(service.isConfigured).toBe(false);
    });

    it('does not reconfigure if already configured', () => {
      const service = freshService();
      service.configure({ endpoint: 'https://first.example.com' });
      expect(service.isConfigured).toBe(true);

      const getTracerCalls = mockProviderGetTracer.mock.calls.length;
      service.configure({ endpoint: 'https://second.example.com' });
      expect(mockProviderGetTracer).toHaveBeenCalledTimes(getTracerCalls);
    });
  });

  describe('startSpan()', () => {
    it('creates a span with the given name', async () => {
      const service = freshService();
      const fn = vi.fn().mockResolvedValue('result');
      await service.startSpan('test-operation', fn);
      expect(mockTracer.startSpan).toHaveBeenCalledWith('test-operation');
    });

    it('returns the result of the wrapped function', async () => {
      const service = freshService();
      const result = await service.startSpan('test-op', vi.fn().mockResolvedValue('hello'));
      expect(result).toBe('hello');
    });

    it('sets span attributes when provided', async () => {
      const service = freshService();
      const attrs = {
        [TelemetryService.ATTR_GEN_AI_SYSTEM]: 'openai',
        [TelemetryService.ATTR_GEN_AI_REQUEST_MODEL]: 'gpt-4.1',
      };
      await service.startSpan('chat', vi.fn().mockResolvedValue('ok'), attrs);
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(attrs);
    });

    it('passes the span to the wrapped function', async () => {
      const service = freshService();
      const fn = vi.fn().mockResolvedValue('done');
      await service.startSpan('test-op', fn);
      expect(fn).toHaveBeenCalledWith(mockSpan);
    });

    it('sets status OK on success', async () => {
      const service = freshService();
      await service.startSpan('test-op', vi.fn().mockResolvedValue('success'));
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 'OK' });
    });

    it('sets status ERROR and records exception on failure', async () => {
      const service = freshService();
      const error = new Error('Something went wrong');
      await expect(service.startSpan('test-op', vi.fn().mockRejectedValue(error))).rejects.toThrow(
        'Something went wrong',
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 'ERROR',
        message: 'Something went wrong',
      });
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
    });

    it('always ends the span on success', async () => {
      const service = freshService();
      await service.startSpan('test-op', vi.fn().mockResolvedValue('ok'));
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('always ends the span on error', async () => {
      const service = freshService();
      await expect(
        service.startSpan('test-op', vi.fn().mockRejectedValue(new Error('fail'))),
      ).rejects.toThrow();
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('re-throws the original error', async () => {
      const service = freshService();
      const error = new Error('Unique error 12345');
      await expect(service.startSpan('test-op', vi.fn().mockRejectedValue(error))).rejects.toBe(
        error,
      );
    });
  });

  describe('startSpan() before configure (no-op tracer)', () => {
    it('works fine without OTLP configuration', async () => {
      const service = freshService();
      expect(service.isConfigured).toBe(false);
      const result = await service.startSpan('unconfigured-op', vi.fn().mockResolvedValue('still works'));
      expect(result).toBe('still works');
      expect(mockTracer.startSpan).toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('handles errors even without OTLP configured', async () => {
      const service = freshService();
      expect(service.isConfigured).toBe(false);
      await expect(
        service.startSpan('unconfigured-op', vi.fn().mockRejectedValue(new Error('runtime error'))),
      ).rejects.toThrow('runtime error');
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('static attributes', () => {
    it('exposes gen_ai.system', () => {
      expect(TelemetryService.ATTR_GEN_AI_SYSTEM).toBe('gen_ai.system');
    });
    it('exposes gen_ai.request.model', () => {
      expect(TelemetryService.ATTR_GEN_AI_REQUEST_MODEL).toBe('gen_ai.request.model');
    });
    it('exposes gen_ai.response.model', () => {
      expect(TelemetryService.ATTR_GEN_AI_RESPONSE_MODEL).toBe('gen_ai.response.model');
    });
    it('exposes gen_ai.usage.input_tokens', () => {
      expect(TelemetryService.ATTR_GEN_AI_USAGE_INPUT_TOKENS).toBe('gen_ai.usage.input_tokens');
    });
    it('exposes gen_ai.usage.output_tokens', () => {
      expect(TelemetryService.ATTR_GEN_AI_USAGE_OUTPUT_TOKENS).toBe('gen_ai.usage.output_tokens');
    });
  });

  describe('tracer getter', () => {
    it('returns the current tracer', () => {
      const service = freshService();
      expect(service.tracer).toBe(mockTracer);
    });

    it('returns updated tracer after configure', () => {
      const service = freshService();
      service.configure({ endpoint: 'https://otel.example.com/v1/traces' });
      expect(service.tracer).toBe(mockTracer);
    });
  });

  describe('logGenAi (a2a-reference-observability)', () => {
    it('logs through the structured observability logger', async () => {
      const service = freshService();
      await service.logGenAi('gen_ai.call', { model: 'gpt-4.1', tokens: 42 });
      expect(mockLoggerInfo).toHaveBeenCalledWith({ model: 'gpt-4.1', tokens: 42 }, 'gen_ai.call');
    });
  });

  describe('recordSpanSpend (agent-budget-otel-bridge)', () => {
    it('feeds span attributes through the otel→budget bridge', async () => {
      const service = freshService();
      const ok = await service.recordSpanSpend({
        'gen_ai.request.model': 'gpt-4.1',
        'gen_ai.usage.input_tokens': 100,
        'gen_ai.usage.output_tokens': 50,
      });
      expect(ok).toBe(true);
      expect(mockOnSpanEnd).toHaveBeenCalled();
    });

    it('returns false (not throw) when the bridge fails', async () => {
      const service = freshService();
      mockOnSpanEnd.mockImplementationOnce(() => {
        throw new Error('bridge boom');
      });
      const ok = await service.recordSpanSpend({ 'gen_ai.request.model': 'gpt-4.1' });
      expect(ok).toBe(false);
    });
  });
});

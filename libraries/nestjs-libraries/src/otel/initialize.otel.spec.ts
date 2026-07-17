import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { initializeOtel } from './initialize.otel';

// F3: prod-without-tracing must warn; dev must stay silent; no exporter created without
// an endpoint (initializeOtel returns early so the NodeSDK require() is never reached).
describe('initializeOtel (F3 prod-warn)', () => {
  const orig = {
    NODE_ENV: process.env.NODE_ENV,
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    disable: process.env.DEV_DISABLE_OPENTELEMETRY,
  };
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.DEV_DISABLE_OPENTELEMETRY;
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    process.env.NODE_ENV = orig.NODE_ENV;
    if (orig.endpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = orig.endpoint;
    if (orig.disable === undefined) delete process.env.DEV_DISABLE_OPENTELEMETRY;
    else process.env.DEV_DISABLE_OPENTELEMETRY = orig.disable;
  });

  it('warns in production when no endpoint is configured', () => {
    process.env.NODE_ENV = 'production';
    initializeOtel();
    expect(warn).toHaveBeenCalledWith(
      'Production tracing disabled — set OTEL_EXPORTER_OTLP_ENDPOINT'
    );
  });

  it('stays silent in development (no endpoint)', () => {
    process.env.NODE_ENV = 'development';
    initializeOtel();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent in production when explicitly opted out', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_DISABLE_OPENTELEMETRY = 'true';
    initializeOtel();
    expect(warn).not.toHaveBeenCalled();
  });
});

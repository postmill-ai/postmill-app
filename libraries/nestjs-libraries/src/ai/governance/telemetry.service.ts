import { Injectable, Logger } from '@nestjs/common';
import { trace, Span, SpanStatusCode, Tracer } from '@opentelemetry/api';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

let OTLPTraceExporter: new (...args: any[]) => any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  OTLPTraceExporter = require('@opentelemetry/exporter-trace-otlp-proto').OTLPTraceExporter;
} catch {
  // Package not installed — telemetry exports will be a no-op
}

const ATTR_GEN_AI_SYSTEM = 'gen_ai.system';
const ATTR_GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
const ATTR_GEN_AI_RESPONSE_MODEL = 'gen_ai.response.model';
const ATTR_GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
const ATTR_GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';

@Injectable()
export class TelemetryService {
  private _tracer: Tracer;
  private _logger = new Logger(TelemetryService.name);
  private _configured = false;
  private _disabled = false;

  constructor() {
    this._tracer = trace.getTracer('postmill-ai');
    if (process.env.DEV_DISABLE_OPENTELEMETRY === 'true' || process.env.DEV_DISABLE_OPENTELEMETRY === '1') {
      this._disabled = true;
    }
  }

  configure(observability: any, _secretSettings?: Record<string, string>) {
    if (this._disabled || this._configured) return;
    if (!observability?.endpoint) return;

    if (!OTLPTraceExporter) {
      this._logger.warn(
        `Observability endpoint set (${observability.endpoint}) but @opentelemetry/exporter-trace-otlp-proto is not installed — telemetry is a no-op`,
      );
      return;
    }

    try {
      const otelHeaders = _secretSettings?.otelHeaders;
      const headers = otelHeaders
        ? typeof otelHeaders === 'string' ? JSON.parse(otelHeaders) : otelHeaders
        : undefined;
      const exporter = new OTLPTraceExporter({
        url: observability.endpoint,
        headers,
      });
      const processor = new BatchSpanProcessor(exporter);
      const provider = new BasicTracerProvider({ spanProcessors: [processor] });
      this._tracer = provider.getTracer('postmill-ai');
      this._logger.log(`OTLP exporter wired to ${observability.endpoint}`);
      this._configured = true;
    } catch (err) {
      this._logger.warn(`Failed to wire OTLP exporter: ${(err as Error).message}`);
    }
  }

  async startSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attrs?: Record<string, string | number | boolean>,
  ): Promise<T> {
    const span = this._tracer.startSpan(name);
    if (attrs) {
      span.setAttributes(attrs);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  }

  get tracer(): Tracer {
    return this._tracer;
  }

  get isConfigured(): boolean {
    return this._configured;
  }

  // ── @reaatech/a2a-reference-observability — structured GenAI logging ──
  private _obsLogger: any | null | false = null;

  private async _getObservabilityLogger(): Promise<any | null> {
    if (this._obsLogger !== null) return this._obsLogger || null;
    try {
      const { createLogger } = await import('@reaatech/a2a-reference-observability');
      this._obsLogger = createLogger({ name: 'postmill-ai' } as any);
    } catch (err) {
      this._logger.warn(`a2a-reference-observability unavailable: ${(err as Error).message}`);
      this._obsLogger = false;
    }
    return this._obsLogger || null;
  }

  /** Structured GenAI log line (no-op-safe when the package is absent). */
  async logGenAi(event: string, fields: Record<string, unknown>): Promise<void> {
    const logger = await this._getObservabilityLogger();
    if (logger?.info) {
      logger.info(fields, event);
    } else {
      this._logger.debug(`${event} ${JSON.stringify(fields)}`);
    }
  }

  // ── @reaatech/agent-budget-otel-bridge — convert a finished GenAI span into a budget
  // spend entry so one instrumentation feeds both traces and cost (§6.1/§7). Self-contained
  // sink (its own BudgetController + SpendStore); lazy + guarded; never throws.
  private _spanListener: any | null | false = null;

  private async _getSpanListener(): Promise<any | null> {
    if (this._spanListener !== null) return this._spanListener || null;
    try {
      const { SpanListener } = await import('@reaatech/agent-budget-otel-bridge');
      const { BudgetController } = await import('@reaatech/agent-budget-engine');
      const { SpendStore } = await import('@reaatech/agent-budget-spend-tracker');
      const controller = new BudgetController({ spendTracker: new SpendStore() } as any);
      this._spanListener = new SpanListener({ controller } as any);
    } catch (err) {
      this._logger.warn(`agent-budget-otel-bridge unavailable: ${(err as Error).message}`);
      this._spanListener = false;
    }
    return this._spanListener || null;
  }

  /**
   * Feed a finished span's gen_ai.* attributes through the otel→budget bridge. Returns true
   * when the bridge processed it, false when the package is unavailable. Never throws.
   */
  async recordSpanSpend(
    attributes: Record<string, unknown>,
    overrides?: {
      requestId?: string;
      cost?: number;
      inputTokens?: number;
      outputTokens?: number;
      modelId?: string;
      provider?: string;
    },
  ): Promise<boolean> {
    const listener = await this._getSpanListener();
    if (!listener) return false;
    try {
      listener.onSpanEnd(attributes, overrides);
      return true;
    } catch (err) {
      this._logger.warn(`otel-bridge onSpanEnd failed: ${(err as Error).message}`);
      return false;
    }
  }

  static readonly ATTR_GEN_AI_SYSTEM = ATTR_GEN_AI_SYSTEM;
  static readonly ATTR_GEN_AI_REQUEST_MODEL = ATTR_GEN_AI_REQUEST_MODEL;
  static readonly ATTR_GEN_AI_RESPONSE_MODEL = ATTR_GEN_AI_RESPONSE_MODEL;
  static readonly ATTR_GEN_AI_USAGE_INPUT_TOKENS = ATTR_GEN_AI_USAGE_INPUT_TOKENS;
  static readonly ATTR_GEN_AI_USAGE_OUTPUT_TOKENS = ATTR_GEN_AI_USAGE_OUTPUT_TOKENS;
}

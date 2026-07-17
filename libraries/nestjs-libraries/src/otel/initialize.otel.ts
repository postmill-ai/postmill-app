import { Logger } from '@nestjs/common';
import { getRequestId } from '@gitroom/nestjs-libraries/chat/async.storage';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

// OpenTelemetry bootstrap. No-ops unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set and
// `DEV_DISABLE_OPENTELEMETRY` is unset. When configured, starts a NodeSDK with auto
// instrumentations + an OTLP/HTTP trace exporter. The SDK is started before Sentry and
// before the Nest app is created (call from main.ts first), so instrumentations can patch
// modules as they load. Shutdown is registered on SIGTERM/SIGINT to compose with the
// graceful-shutdown handler (G1).
let sdk: NodeSDK | null = null;

export function initializeOtel(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!endpoint || process.env.DEV_DISABLE_OPENTELEMETRY) {
    // F3: make the production blind spot loud — tracing is off and no exporter is
    // configured, but the operator hasn't explicitly opted out. Dev stays silent.
    if (
      process.env.NODE_ENV === 'production' &&
      !endpoint &&
      !process.env.DEV_DISABLE_OPENTELEMETRY
    ) {
      new Logger('OpenTelemetry').warn(
        'Production tracing disabled — set OTEL_EXPORTER_OTLP_ENDPOINT'
      );
    }
    return;
  }

  if (sdk) {
    // Already initialized — guard against a double call.
    return;
  }

  try {
    // These modules are imported statically (ESM lint requirement); the heavy SDK setup
    // still only runs when OTel is enabled, because this block is guarded by the env
    // checks above.

    // G4: stamp the per-request correlation id (set by the request-context ALS in
    // async.storage.ts) onto every span as `request.id`. onStart runs in the caller's
    // async context, so the ALS store is still active. This processor only exists once
    // the SDK is started — when OTel is off (the production default) initializeOtel()
    // returns above and nothing here runs.
    const requestIdProcessor = {
      onStart(span: { setAttribute(key: string, value: string): void }) {
        const requestId = getRequestId();
        if (requestId) {
          span.setAttribute('request.id', requestId);
        }
      },
      onEnd() {
        /* no-op */
      },
      shutdown() {
        return Promise.resolve();
      },
      forceFlush() {
        return Promise.resolve();
      },
    };

    sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME || 'postmill-backend',
      // Passing `spanProcessors` supersedes `traceExporter`, so export via an explicit
      // BatchSpanProcessor alongside the request-id processor.
      spanProcessors: [
        requestIdProcessor,
        new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint })),
      ],
      instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk!.start();
    new Logger('OpenTelemetry').log(
      `OpenTelemetry tracing started (exporter: ${endpoint})`
    );

    const shutdown = () => {
      sdk
        ?.shutdown()
        .catch((err: unknown) =>
          new Logger('OpenTelemetry').warn(
            `OpenTelemetry shutdown error: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        );
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (err) {
    new Logger('OpenTelemetry').warn(
      `OpenTelemetry failed to initialize: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

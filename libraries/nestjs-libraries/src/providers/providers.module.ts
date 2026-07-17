import { Global, Logger, Module } from '@nestjs/common';
import {
  ProviderKernel,
  EncryptionPort,
  SafeFetchPort,
  LoggerPort,
  TelemetryPort,
} from '@gitroom/provider-kernel';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
import { TelemetryService } from '@gitroom/nestjs-libraries/ai/governance/telemetry.service';
import { RuntimeContextFactory } from './runtime-context.factory';
import { ProviderResolutionService } from './provider-resolution.service';
import { PROVIDER_KERNEL } from './provider-kernel.token';

// Re-exported for backward compatibility; the token lives in its own module to
// avoid the providers.module ↔ provider-resolution.service circular import.
export { PROVIDER_KERNEL };

function adaptEncryption(service: EncryptionService): EncryptionPort {
  return {
    encrypt: (value) => service.encrypt(value),
    decrypt: (value) => service.decrypt(value),
  };
}

function adaptSafeFetch(): SafeFetchPort {
  return async (input, init) => {
    // 4.4: input is string|URL. `URL.href` (not the generic toString of a
    // Request) is the correct resolved URL string for SSRF validation.
    const url = typeof input === 'string' ? input : input.href;
    return safeFetch(url, init as RequestInit);
  };
}

function adaptLogger(logger: Logger): LoggerPort {
  return {
    log: (message, meta) => logger.log(message, meta),
    warn: (message, meta) => logger.warn(message, meta),
    error: (message, meta) => logger.error(message, meta),
    debug: (message, meta) => logger.debug(message, meta),
  };
}

function adaptTelemetry(telemetry: TelemetryService): TelemetryPort {
  return {
    recordCall: async (record) => {
      try {
        await telemetry.logGenAi('provider-call', {
          domain: record.domain,
          providerId: record.providerId,
          version: record.version,
          ok: record.ok,
          latencyMs: record.latencyMs,
          costUsd: record.costUsd,
          error: record.error,
        });
      } catch {
        // Telemetry must never break provider calls.
      }
    },
  };
}

// 4.8: only telemetry is consumed by KernelOptions today; the encryption/logger
// ports are provided to adapters via the 'ProviderPorts' factory, not the
// kernel, so they are not parameters here.
export function createProviderKernel(
  telemetry: TelemetryService,
): ProviderKernel {
  return new ProviderKernel({
    telemetry: adaptTelemetry(telemetry),
  });
}

@Global()
@Module({
  providers: [
    Logger,
    {
      provide: PROVIDER_KERNEL,
      useFactory: (telemetry: TelemetryService) => {
        return createProviderKernel(telemetry);
      },
      inject: [TelemetryService],
    },
    {
      provide: 'ProviderPorts',
      useFactory: (
        encryption: EncryptionService,
        logger: Logger,
        telemetry: TelemetryService,
      ) => ({
        encryption: adaptEncryption(encryption),
        fetch: adaptSafeFetch(),
        logger: adaptLogger(logger),
        telemetry: adaptTelemetry(telemetry),
      }),
      inject: [EncryptionService, Logger, TelemetryService],
    },
    RuntimeContextFactory,
    ProviderResolutionService,
  ],
  exports: [PROVIDER_KERNEL, 'ProviderPorts', RuntimeContextFactory, ProviderResolutionService],
})
export class ProvidersModule {}

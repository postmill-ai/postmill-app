import { Inject, Injectable } from '@nestjs/common';
import {
  ProviderRuntimeContext,
  EncryptionPort,
  SafeFetchPort,
  LoggerPort,
  TelemetryPort,
} from '@gitroom/provider-kernel';

export interface ProviderPorts {
  encryption: EncryptionPort;
  fetch: SafeFetchPort;
  logger: LoggerPort;
  telemetry: TelemetryPort;
}

@Injectable()
export class RuntimeContextFactory {
  constructor(
    @Inject('ProviderPorts')
    private readonly _ports: ProviderPorts,
  ) {}

  build(options: {
    credentials?: Record<string, string>;
    orgId?: string;
    extras?: Record<string, unknown>;
  }): ProviderRuntimeContext {
    return {
      credentials: options.credentials ?? {},
      encryption: this._ports.encryption,
      fetch: this._ports.fetch,
      logger: this._ports.logger,
      telemetry: this._ports.telemetry,
      orgId: options.orgId,
      extras: options.extras,
    };
  }
}

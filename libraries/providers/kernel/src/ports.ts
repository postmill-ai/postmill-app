export interface EncryptionPort {
  encrypt(value: string): Promise<string> | string;
  decrypt(value: string): Promise<string> | string;
}

export interface SafeFetchPort {
  // 4.4: narrowed to string|URL. The nestjs `adaptSafeFetch` delegate resolves
  // the URL to a string for SSRF validation; a `Request` object was previously
  // stringified to the literal "[object Request]", silently dropping its
  // method/headers/body — so `Request` is not an accepted input.
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface LoggerPort {
  log(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export interface TelemetryCallRecord {
  domain: string;
  providerId: string;
  version: string;
  ok: boolean;
  latencyMs: number;
  costUsd?: number;
  error?: string;
}

export interface TelemetryPort {
  recordCall(record: TelemetryCallRecord): void;
}

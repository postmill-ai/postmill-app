export interface EncryptionPort {
  encrypt(value: string): Promise<string> | string;
  decrypt(value: string): Promise<string> | string;
}

export interface SafeFetchPort {
  // 4.4: narrowed to string|URL. The nestjs `adaptSafeFetch` delegate resolves
  // the URL to a string for SSRF validation; a `Request` object was previously
  // stringified to the literal "[object Request]", silently dropping its
  // method/headers/body — so `Request` is not an accepted input.
  // `timeoutMs` extends the default outbound timeout for known-slow calls
  // (e.g. OpenAI image generation, which routinely exceeds 30s). `ipFamily`
  // pins DNS selection for providers with a broken address-family route.
  (
    input: string | URL,
    init?: RequestInit & { timeoutMs?: number; ipFamily?: 4 | 6 },
  ): Promise<Response>;
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

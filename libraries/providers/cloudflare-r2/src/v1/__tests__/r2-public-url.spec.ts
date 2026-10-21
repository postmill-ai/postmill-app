import { describe, it, expect, vi } from 'vitest';
import { LoggerPort, ProviderRuntimeContext, SafeFetchPort } from '@postmill-ai/provider-kernel';
import { cloudflarer2StorageModule } from '../storage.adapter';

const logger: LoggerPort = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const makeCtx = (extras?: Record<string, unknown>): ProviderRuntimeContext => ({
  credentials: { accessKeyId: 'akid', secretAccessKey: 'secret' },
  encryption: { encrypt: (v) => v, decrypt: (v) => v },
  fetch: vi.fn() as unknown as SafeFetchPort,
  logger,
  telemetry: { recordCall: vi.fn() },
  extras: {
    bucket: 'media-bucket',
    endpoint: 'https://account-id.r2.cloudflarestorage.com',
    ...extras,
  },
});

describe('R2 public URL requirement', () => {
  it('fails the config test loudly when no publicUrl is configured', async () => {
    // Without a public base, getFileUrl can only return a root-relative
    // `/<key>` — designer-doc src rejects it and nothing off-origin can
    // download it. R2's public URL can't be derived, so the test must refuse.
    const cap = cloudflarer2StorageModule.create(makeCtx());
    const res = await cap.testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Public URL');
  });

  it('returns absolute URLs from getFileUrl when a publicUrl is configured', () => {
    const cap = cloudflarer2StorageModule.create(
      makeCtx({ publicUrl: 'https://cdn.example.com' }),
    );
    expect(cap.getFileUrl('abc123.png')).toBe('https://cdn.example.com/abc123.png');
  });
});

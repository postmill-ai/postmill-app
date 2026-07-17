import { describe, it, expect } from 'vitest';
import { ProviderKernel } from '../kernel';
import { ProviderModule } from '../module';
import { ProviderManifest, validateManifest, ProviderVersionStatus } from '../manifest';
import {
  ProviderVersionPreviewError,
  ProviderVersionDeprecatedForWriteError,
} from '../errors';
import { TelemetryCallRecord } from '../ports';

function makeManifest(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    domain: 'ai',
    providerId: 'openai',
    version: 'v1',
    displayName: 'OpenAI',
    status: 'active',
    credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
    capabilities: { text: true },
    ...overrides,
  };
}

function makeModule(
  overrides: Partial<ProviderModule> = {},
  manifestOverrides: Partial<ProviderManifest> = {},
): ProviderModule {
  return {
    manifest: makeManifest(manifestOverrides),
    create: () => ({}) as any,
    validateCredentials: async () => ({ ok: true }),
    ...overrides,
  };
}

describe('4.12 preview version error', () => {
  it('resolveForWrite throws ProviderVersionPreviewError for a preview version', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule({}, { status: 'preview' }));
    expect(() => kernel.resolveForWrite('ai', 'openai', 'v1')).toThrow(
      ProviderVersionPreviewError,
    );
    // and NOT the deprecated error (distinct class)
    try {
      kernel.resolveForWrite('ai', 'openai', 'v1');
    } catch (err) {
      expect(err).not.toBeInstanceOf(ProviderVersionDeprecatedForWriteError);
    }
  });

  it('allowPreview opt-in permits pinning a preview version', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule({}, { status: 'preview' }));
    expect(
      kernel.resolveForWrite('ai', 'openai', 'v1', { allowPreview: true }).manifest
        .version,
    ).toBe('v1');
  });
});

describe('4.5 manifest validation', () => {
  it('rejects an unknown domain', () => {
    expect(() =>
      validateManifest(makeManifest({ domain: 'shortlinks' as any })),
    ).toThrow(/invalid domain/);
  });
  it('rejects a providerId containing a slash', () => {
    expect(() => validateManifest(makeManifest({ providerId: 'a/b' }))).toThrow(
      /invalid providerId/,
    );
  });
  it('rejects a providerId with whitespace', () => {
    expect(() => validateManifest(makeManifest({ providerId: 'a b' }))).toThrow(
      /invalid providerId/,
    );
  });
  it('accepts a valid manifest', () => {
    expect(() => validateManifest(makeManifest())).not.toThrow();
  });
});

describe('PF-06 semver-aware version ordering', () => {
  it('latestActive selects stable v2 over v2-beta', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule({}, { version: 'v2', status: 'active' }));
    kernel.register(makeModule({}, { version: 'v2-beta', status: 'preview' }));
    expect(kernel.latestActive('ai', 'openai')?.manifest.version).toBe('v2');
  });

  it('latestActive is deterministic regardless of registration order', () => {
    const a = new ProviderKernel();
    a.register(makeModule({}, { version: 'v2', status: 'active' }));
    a.register(makeModule({}, { version: 'v2.0.1', status: 'active' }));
    const b = new ProviderKernel();
    b.register(makeModule({}, { version: 'v2.0.1', status: 'active' }));
    b.register(makeModule({}, { version: 'v2', status: 'active' }));
    expect(a.latestActive('ai', 'openai')?.manifest.version).toBe('v2.0.1');
    expect(b.latestActive('ai', 'openai')?.manifest.version).toBe('v2.0.1');
  });

  it('rejects a prerelease version that is not marked preview', () => {
    const kernel = new ProviderKernel();
    expect(() =>
      kernel.register(makeModule({}, { version: 'v2-beta', status: 'active' })),
    ).toThrow(/preview/);
  });

  it('allows a prerelease version marked preview', () => {
    const kernel = new ProviderKernel();
    expect(() =>
      kernel.register(makeModule({}, { version: 'v2-beta', status: 'preview' })),
    ).not.toThrow();
  });
});

describe('4.6 kernel-owned health does not cross-pollute between kernels', () => {
  it('two kernels registering the same module constant keep separate counters', () => {
    const shared = makeModule();
    const k1 = new ProviderKernel();
    const k2 = new ProviderKernel();
    k1.register(shared);
    k2.register(shared);
    k1.recordSuccess({ domain: 'ai', providerId: 'openai', version: 'v1' });
    expect(k1.getHealth('ai', 'openai', 'v1')?.successCount).toBe(1);
    expect(k2.getHealth('ai', 'openai', 'v1')?.successCount).toBe(0);
  });

  it('does not mutate the module object', () => {
    const mod = makeModule();
    const kernel = new ProviderKernel();
    kernel.register(mod);
    kernel.recordSuccess({ domain: 'ai', providerId: 'openai', version: 'v1' });
    expect((mod as any).health).toBeUndefined();
  });
});

describe('4.1 / 4.3 telemetry latency + error scrubbing', () => {
  it('forwards the provided latency and scrubs secrets from error messages', () => {
    const records: TelemetryCallRecord[] = [];
    const kernel = new ProviderKernel({
      telemetry: { recordCall: (r) => records.push(r) },
    });
    kernel.register(makeModule());
    const key = { domain: 'ai' as const, providerId: 'openai', version: 'v1' };
    kernel.recordSuccess(key, 123);
    kernel.recordError(
      key,
      'API error 401 Authorization: Bearer sk-secret-token-abcdef body',
      42,
    );
    expect(records[0]).toMatchObject({ ok: true, latencyMs: 123 });
    expect(records[1].ok).toBe(false);
    expect(records[1].latencyMs).toBe(42);
    expect(records[1].error).not.toContain('sk-secret-token-abcdef');
    expect(records[1].error).toContain('[redacted]');
  });
});

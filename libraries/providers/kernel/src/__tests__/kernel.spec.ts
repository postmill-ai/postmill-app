import { describe, it, expect } from 'vitest';
import { ProviderKernel } from '../kernel';
import { ProviderModule } from '../module';
import { ProviderManifest } from '../manifest';
import { ProviderVersionRetiredError, ProviderNotFoundError, ProviderVersionDeprecatedForWriteError } from '../errors';
import { qualify, parseQualified } from '../identity';

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

function makeModule(overrides: Partial<ProviderModule> = {}, manifestOverrides: Partial<ProviderManifest> = {}): ProviderModule {
  const manifest = makeManifest(manifestOverrides);
  return {
    manifest,
    create: () => ({}) as any,
    validateCredentials: async () => ({ ok: true }),
    ...overrides,
  };
}

describe('ProviderKernel', () => {
  it('registers and retrieves a module', () => {
    const kernel = new ProviderKernel();
    const mod = makeModule();
    kernel.register(mod);
    expect(kernel.get('ai', 'openai', 'v1')).toBe(mod);
  });

  it('rejects duplicate registration', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule());
    expect(() => kernel.register(makeModule())).toThrow(/Duplicate registration/);
  });

  it('latestActive selects the highest active version', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule({}, { version: 'v1' }));
    kernel.register(makeModule({}, { version: 'v2' }));
    kernel.register(makeModule({}, { version: 'v3', status: 'preview' }));
    expect(kernel.latestActive('ai', 'openai')?.manifest.version).toBe('v2');
  });

  it('resolveForRead throws ProviderVersionRetiredError for retired versions', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule({}, { status: 'retired' }));
    expect(() => kernel.resolveForRead('ai', 'openai', 'v1')).toThrow(ProviderVersionRetiredError);
  });

  it('resolveForRead throws ProviderNotFoundError for unknown provider', () => {
    const kernel = new ProviderKernel();
    expect(() => kernel.resolveForRead('ai', 'unknown', 'v1')).toThrow(ProviderNotFoundError);
  });

  it('resolveForWrite excludes deprecated versions', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule({}, { status: 'deprecated' }));
    expect(() => kernel.resolveForWrite('ai', 'openai')).toThrow(ProviderNotFoundError);
    expect(() => kernel.resolveForWrite('ai', 'openai', 'v1')).toThrow(ProviderVersionDeprecatedForWriteError);
  });

  it('resolveForWrite defaults to latest active', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule({}, { version: 'v1' }));
    kernel.register(makeModule({}, { version: 'v2' }));
    expect(kernel.resolveForWrite('ai', 'openai').manifest.version).toBe('v2');
  });

  it('versions returns all manifests for a provider', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule({}, { version: 'v1' }));
    kernel.register(makeModule({}, { version: 'v2', status: 'preview' }));
    expect(kernel.versions('ai', 'openai')).toHaveLength(2);
  });

  it('listManifests filters by domain', () => {
    const kernel = new ProviderKernel();
    kernel.register(makeModule({ domain: 'ai' } as any, { domain: 'ai' }));
    kernel.register(makeModule({ domain: 'media' } as any, { domain: 'media', providerId: 'runway' }));
    expect(kernel.listManifests('ai')).toHaveLength(1);
    expect(kernel.listManifests()).toHaveLength(2);
  });

  it('qualified id round-trips', () => {
    expect(parseQualified(qualify('openai', 'v1'))).toEqual({ providerId: 'openai', version: 'v1' });
    expect(parseQualified('openai')).toEqual({ providerId: 'openai' });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, GoneException, Logger } from '@nestjs/common';
import {
  ProviderKernel,
  ProviderModule,
  ProviderNotFoundError,
  ProviderVersionRetiredError,
  ProviderVersionInvalidError,
} from '@gitroom/provider-kernel';
import { RuntimeContextFactory } from './runtime-context.factory';
import { ProviderResolutionService } from './provider-resolution.service';

function makeAiModule(
  overrides: Partial<ProviderModule> = {},
  version = 'v1',
  status: string = 'active',
): ProviderModule {
  return {
    manifest: {
      domain: 'ai',
      providerId: 'openai',
      version,
      displayName: 'OpenAI',
      status: status as any,
      credentialFields: [],
      capabilities: {
        text: true,
        image: true,
        vision: true,
        embeddings: true,
        speech: true,
        tools: true,
      },
    },
    create: () => ({ model: version }) as any,
    validateCredentials: async () => ({ ok: true }),
    ...overrides,
  };
}

function createResolutionService(
  kernel: ProviderKernel,
): ProviderResolutionService {
  const ports = {
    encryption: {
      encrypt: (v: string) => v,
      decrypt: (v: string) => v,
    },
    fetch: async () => new Response(),
    logger: {
      log: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    telemetry: {
      recordCall: () => {},
    },
  };

  return new ProviderResolutionService(
    kernel,
    new RuntimeContextFactory(ports as any),
    new Logger(),
  );
}

describe('ProviderResolutionService', () => {
  let kernel: ProviderKernel;
  let service: ProviderResolutionService;

  beforeEach(() => {
    kernel = new ProviderKernel();
    kernel.register(makeAiModule({}, 'v1'));
    kernel.register(makeAiModule({}, 'v2'));
    kernel.register(makeAiModule({}, 'v3', 'retired'));

    service = createResolutionService(kernel);
  });

  it('resolve-on-read uses pinned version', () => {
    const v1 = service.resolveAI('openai', { version: 'v1' });
    expect((v1 as any).model).toBe('v1');

    const v2 = service.resolveAI('openai', { version: 'v2' });
    expect((v2 as any).model).toBe('v2');
  });

  it('pin-on-write persists version and resolve-on-read uses the pinned version', () => {
    // Simulating a config write path: kernel.resolveForWrite picks the latest
    // active version and the caller persists it. A later resolve-on-read uses
    // that pinned version instead of silently moving to latest active.
    const pinned = kernel.resolveForWrite('ai', 'openai');
    expect(pinned.manifest.version).toBe('v2');

    const capability = service.resolveAI('openai', {
      version: pinned.manifest.version,
    });
    expect((capability as any).model).toBe('v2');
  });

  // 1.5: read-path lifecycle errors propagate RAW so the global
  // ProviderExceptionFilter maps them (retired → 410 + latestActive hint,
  // not-found → 404, with providerId/version in the body). Mapping them here
  // would bypass the filter and lose the richer body.
  it('retired pin propagates ProviderVersionRetiredError (filter maps to 410)', () => {
    expect(() => service.resolveAI('openai', { version: 'v3' })).toThrow(
      ProviderVersionRetiredError,
    );
  });

  it('unregistered version propagates ProviderNotFoundError (filter maps to 404)', () => {
    expect(() => service.resolveAI('openai', { version: 'v99' })).toThrow(
      ProviderNotFoundError,
    );
  });

  // 1.4: a deprecated version can no longer be NEWLY pinned, but an in-place update
  // of a row already pinned to it (currentVersion === target) is allowed.
  it('resolveWriteVersion: deprecated in-place update allowed; new pin rejected', () => {
    kernel.register(makeAiModule({}, 'v4', 'deprecated'));

    // In-place update of a v4-pinned row (rotate/disable) → allowed.
    expect(
      service.resolveWriteVersion('ai', 'openai', 'v4', { currentVersion: 'v4' }),
    ).toBe('v4');

    // A create / fresh pin to the deprecated version → 400.
    expect(() => service.resolveWriteVersion('ai', 'openai', 'v4')).toThrow(
      BadRequestException,
    );
    // Changing an existing row FROM v1 TO the deprecated v4 is also a new pin → 400.
    expect(() =>
      service.resolveWriteVersion('ai', 'openai', 'v4', { currentVersion: 'v1' }),
    ).toThrow(BadRequestException);
  });

  // 4.1: the capability cache key is independent of caller object-key order, so
  // two logically-identical `extras` resolve to the SAME cached instance.
  it('caches on a key-order-independent extras fingerprint', () => {
    const a = service.resolveAI('openai', {
      version: 'v1',
      extras: { bucket: 'b', region: 'r' },
    } as any);
    const b = service.resolveAI('openai', {
      version: 'v1',
      extras: { region: 'r', bucket: 'b' },
    } as any);
    expect(a).toBe(b);
  });

  it('latestActiveVersion returns the highest active version', () => {
    expect(service.latestActiveVersion('ai', 'openai')).toBe('v2');
  });

  it('latestActiveVersion returns undefined for unknown provider', () => {
    expect(service.latestActiveVersion('ai', 'unknown')).toBeUndefined();
  });

  // 1.2 — unpinned resolution resolves latest-active, not a hard v1.
  it('resolves latest-active version when no version is pinned', () => {
    const cap = service.resolveAI('openai');
    expect((cap as any).model).toBe('v2');
  });

  it('resolves a v2-only provider (v1 retired) with no version pinned', () => {
    const k = new ProviderKernel();
    k.register(makeAiModule({}, 'v1', 'retired'));
    k.register(makeAiModule({}, 'v2'));
    const svc = createResolutionService(k);
    expect((svc.resolveAI('openai') as any).model).toBe('v2');
  });

  // 0.5 — extras must partition the capability cache (stateful storage adapters).
  it('does not share a cached adapter across configs with different extras', () => {
    let builds = 0;
    const k = new ProviderKernel();
    k.register({
      manifest: {
        domain: 'storage',
        providerId: 's3',
        version: 'v1',
        displayName: 'S3',
        status: 'active',
        credentialFields: [],
        capabilities: {},
      },
      create: (ctx) => {
        builds += 1;
        return { bucket: (ctx.extras as any)?.bucket } as any;
      },
      validateCredentials: async () => ({ ok: true }),
    } as ProviderModule);
    const svc = createResolutionService(k);
    const a = svc.resolveStorage('s3', {
      orgId: 'o1',
      credentials: { key: 'same' },
      extras: { bucket: 'bucket-a' },
    });
    const b = svc.resolveStorage('s3', {
      orgId: 'o1',
      credentials: { key: 'same' },
      extras: { bucket: 'bucket-b' },
    });
    expect((a as any).bucket).toBe('bucket-a');
    expect((b as any).bucket).toBe('bucket-b');
    expect(builds).toBe(2);
  });

  // 1.3 — invalidate() rebuilds the capability with fresh config.
  it('invalidate() forces a rebuild on the next resolve', () => {
    const cap1 = service.resolveAI('openai', { version: 'v1', orgId: 'o1' });
    const cap2 = service.resolveAI('openai', { version: 'v1', orgId: 'o1' });
    expect(cap1).toBe(cap2); // cached
    service.invalidate('ai', 'openai', 'o1');
    const cap3 = service.resolveAI('openai', { version: 'v1', orgId: 'o1' });
    expect(cap3).not.toBe(cap1); // rebuilt
  });

  // resolveWriteVersion — 1.1 lifecycle mapping to HTTP.
  it('resolveWriteVersion maps a retired version to 410 Gone', () => {
    expect(() => service.resolveWriteVersion('ai', 'openai', 'v3')).toThrow(
      GoneException,
    );
  });
  it('resolveWriteVersion maps an unknown version to 400', () => {
    expect(() => service.resolveWriteVersion('ai', 'openai', 'v9')).toThrow(
      BadRequestException,
    );
  });
  it('resolveWriteVersion returns latest-active when unpinned', () => {
    expect(service.resolveWriteVersion('ai', 'openai')).toBe('v2');
  });

  it('PF-03: empty-string version is invalid on read', () => {
    expect(() => service.resolveAI('openai', { version: '' })).toThrow(
      ProviderVersionInvalidError,
    );
  });

  it('PF-03: empty-string version is invalid on write', () => {
    expect(() => service.resolveWriteVersion('ai', 'openai', '')).toThrow(
      BadRequestException,
    );
  });

  it('PF-04: spoofed currentVersion is rejected and deprecated new-pin fails', () => {
    kernel.register(makeAiModule({}, 'v4', 'deprecated'));
    // Caller lies and claims currentVersion is the deprecated v4, but the kernel
    // has no such registered current version for this org's config. The bypass
    // must not apply, so pinning v4 freshly is rejected.
    expect(() =>
      service.resolveWriteVersion('ai', 'openai', 'v4', { currentVersion: 'v4-spoofed' }),
    ).toThrow(BadRequestException);
  });

  it('resolveContentPack returns the versioned content-pack capability', () => {
    kernel.register({
      manifest: {
        domain: 'contentpack',
        providerId: 'magnific',
        version: 'v1',
        displayName: 'Magnific',
        status: 'active',
        credentialFields: [],
        capabilities: ['photos', 'vectors', 'icons', 'videos'],
      },
      create: () => ({
        identifier: 'magnific',
        capabilities: ['photos', 'vectors', 'icons', 'videos'],
        search: async () => ({ items: [] }),
        resolveDownload: async () => 'https://example.com/download',
      }),
    } as ProviderModule);

    const capability = service.resolveContentPack('magnific');
    expect(capability.identifier).toBe('magnific');
    expect(capability.capabilities).toContain('photos');
  });
});

import { describe, it, expect } from 'vitest';
import { providerModules } from '@gitroom/backend/providers.generated';
import { runDomainConformance } from '../testing/conformance';

/**
 * Universal provider conformance gate (plan B2 + B3).
 *
 * B2: every registered module must have a valid manifest, matching domain, and a
 *     pure `create()` (no network at construction).
 * B3: the capability created by `module.create(ctx)` must expose every non-optional
 *     method of its domain interface (`kernel/src/domains/<domain>.ts`).
 *
 * `runDomainConformance` THROWS on failure (it does not register tests), so every
 * call is inside an `it()`. The social bridge re-exposes its legacy methods on the
 * created capability, so asserting on the created capability (what the helper does)
 * correctly covers social too.
 */

// Required (non-optional) methods per domain — verified against
// libraries/providers/kernel/src/domains/<domain>.ts.
const REQUIRED_METHODS: Record<string, string[]> = {
  social: ['post', 'generateAuthUrl', 'authenticate', 'maxLength', 'checkValidity'],
  media: ['generateImage', 'generateVideo', 'generateAudio', 'generateAvatar'],
  storage: [
    'uploadSimple',
    'removeFile',
    'readFile',
    'writeBuffer',
    'testConnection',
    'listFiles',
    'getFileUrl',
    'deleteFile',
    'getUsageBytes',
  ],
  shortlink: ['createShortLink', 'validateCredentials', 'resolveDomain'],
  ai: ['listModels', 'validateCredentials', 'createLanguageModel', 'createLangchainModel'],
  vpn: ['validateConfig'],
  contentpack: ['search', 'resolveDownload'],
  email: ['send', 'isConfigured'],
  auth: ['generateLink', 'getToken', 'getUser'],
};

// H5 — lock the base-class consolidation. The migrated adapters MUST extend the shared
// bases so the duplicated scaffolding (bearer headers / `_clean` / poll loop, and the
// shortlink validate/stats skeleton) cannot drift back into per-adapter copies.
//
// NOTE: `providerModules` is loaded through the workspace's node_modules graph, which
// resolves `@gitroom/provider-kernel` to a different module instance than this spec's alias
// import — so a literal `toBeInstanceOf(<imported base>)` always fails (two distinct class
// objects). We instead resolve the base constructor from the adapter's OWN prototype chain
// (its realm) and assert a real `instanceof` against that — a genuine extends-the-base lock.
const MIGRATED_BEARER_MEDIA = ['deepinfra', 'ltx', 'higgsfield', 'leonardo', 'recraft', 'fireworks'];
const MIGRATED_BASE_SHORTLINK = ['bitly', 'blink'];
const fakeRuntime: any = {
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
};

// Walk the prototype chain and return the constructor whose name matches `baseName`.
function baseCtorByName(instance: object, baseName: string): (new (...a: any[]) => any) | undefined {
  let proto = Object.getPrototypeOf(instance);
  while (proto) {
    if (proto.constructor?.name === baseName) return proto.constructor;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

function moduleFor(domain: string, providerId: string) {
  const m = providerModules.find(
    (x) => x.manifest.domain === domain && x.manifest.providerId === providerId && x.manifest.version === 'v1',
  );
  expect(m, `${domain}/${providerId}@v1 module not registered`).toBeDefined();
  return m!;
}

describe('H5 — consolidated base classes', () => {
  it.each(MIGRATED_BEARER_MEDIA)('media/%s@v1 extends BearerTokenMediaAdapter', (id) => {
    const instance = moduleFor('media', id).create(fakeRuntime) as object;
    const Base = baseCtorByName(instance, 'BearerTokenMediaAdapter');
    expect(Base, `media/${id}@v1 does not extend BearerTokenMediaAdapter`).toBeDefined();
    expect(instance).toBeInstanceOf(Base!);
  });

  it.each(MIGRATED_BASE_SHORTLINK)('shortlink/%s@v1 extends BaseShortLinkAdapter', (id) => {
    const instance = moduleFor('shortlink', id).create(fakeRuntime) as object;
    const Base = baseCtorByName(instance, 'BaseShortLinkAdapter');
    expect(Base, `shortlink/${id}@v1 does not extend BaseShortLinkAdapter`).toBeDefined();
    expect(instance).toBeInstanceOf(Base!);
  });
});

describe.each(providerModules)(
  '$manifest.domain/$manifest.providerId@$manifest.version',
  (m) => {
    // B2 — manifest + create() purity + domain match + capability instantiation.
    it('passes manifest conformance', () => {
      runDomainConformance(m.manifest.domain, m, {}, {});
    });

    // B3 — required-method conformance on the CREATED capability.
    const requiredMethods = REQUIRED_METHODS[m.manifest.domain];
    if (requiredMethods) {
      it('implements all required domain methods', () => {
        runDomainConformance(m.manifest.domain, m, { requiredMethods }, {});
      });
    } else {
      it.fails(
        `has no required-method list for unknown domain "${m.manifest.domain}"`,
        () => {
          throw new Error(`unknown domain ${m.manifest.domain}`);
        },
      );
    }
  },
);

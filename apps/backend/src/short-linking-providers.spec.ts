import { describe, it, expect } from 'vitest';
import { ShortLinkAdapter } from '@postmill-ai/nestjs-libraries/short-linking/short-link.interface';
import bitlyModules from '@postmill-ai/provider-bitly';
import blinkModules from '@postmill-ai/provider-blink';
import cleanuriModules from '@postmill-ai/provider-cleanuri';
import cuttlyModules from '@postmill-ai/provider-cuttly';
import dubModules from '@postmill-ai/provider-dub';
import isgdModules from '@postmill-ai/provider-isgd';
import linklyModules from '@postmill-ai/provider-linkly';
import owlyModules from '@postmill-ai/provider-owly';
import pixelmeModules from '@postmill-ai/provider-pixelme';
import rebrandlyModules from '@postmill-ai/provider-rebrandly';
import replugModules from '@postmill-ai/provider-replug';
import shortioModules from '@postmill-ai/provider-shortio';
import sniplyModules from '@postmill-ai/provider-sniply';
import switchyModules from '@postmill-ai/provider-switchy';
import t2mModules from '@postmill-ai/provider-t2m';
import tinyccModules from '@postmill-ai/provider-tinycc';
import tinyurlModules from '@postmill-ai/provider-tinyurl';
import tlyModules from '@postmill-ai/provider-tly';
import vgdModules from '@postmill-ai/provider-vgd';

// Each relocated short-link package module is built into a real adapter instance
// (the same modules ProvidersBootstrap registers into the kernel). These are the
// documented capability counts that used to live next to the in-tree adapters.
const shortlinkModules = [
  ...bitlyModules,
  ...blinkModules,
  ...cleanuriModules,
  ...cuttlyModules,
  ...dubModules,
  ...isgdModules,
  ...linklyModules,
  ...owlyModules,
  ...pixelmeModules,
  ...rebrandlyModules,
  ...replugModules,
  ...shortioModules,
  ...sniplyModules,
  ...switchyModules,
  ...t2mModules,
  ...tinyccModules,
  ...tinyurlModules,
  ...tlyModules,
  ...vgdModules,
].filter((m) => m.manifest.domain === 'shortlink');

describe('Short-link provider capabilities (documented counts)', () => {
  const stubFetch = (async () => new Response()) as unknown as typeof fetch;

  const adapters: ShortLinkAdapter[] = shortlinkModules.map(
    (mod) => mod.create({ fetch: stubFetch } as any) as ShortLinkAdapter,
  );

  it('has exactly 19 registered adapters', () => {
    expect(adapters).toHaveLength(19);
  });

  it('has exactly 10 adapters with statistics: true', () => {
    const withStats = adapters.filter((a) => a.capabilities.statistics);
    expect(withStats).toHaveLength(10);
  });

  it('has exactly 13 adapters with customDomain: true', () => {
    const withCustomDomain = adapters.filter((a) => a.capabilities.customDomain);
    expect(withCustomDomain).toHaveLength(13);
  });
});

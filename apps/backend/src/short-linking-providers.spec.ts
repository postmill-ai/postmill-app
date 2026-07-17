import { describe, it, expect } from 'vitest';
import { ShortLinkAdapter } from '@gitroom/nestjs-libraries/short-linking/short-link.interface';
import bitlyModules from '@gitroom/provider-bitly';
import blinkModules from '@gitroom/provider-blink';
import cleanuriModules from '@gitroom/provider-cleanuri';
import cuttlyModules from '@gitroom/provider-cuttly';
import dubModules from '@gitroom/provider-dub';
import isgdModules from '@gitroom/provider-isgd';
import linklyModules from '@gitroom/provider-linkly';
import owlyModules from '@gitroom/provider-owly';
import pixelmeModules from '@gitroom/provider-pixelme';
import rebrandlyModules from '@gitroom/provider-rebrandly';
import replugModules from '@gitroom/provider-replug';
import shortioModules from '@gitroom/provider-shortio';
import sniplyModules from '@gitroom/provider-sniply';
import switchyModules from '@gitroom/provider-switchy';
import t2mModules from '@gitroom/provider-t2m';
import tinyccModules from '@gitroom/provider-tinycc';
import tinyurlModules from '@gitroom/provider-tinyurl';
import tlyModules from '@gitroom/provider-tly';
import vgdModules from '@gitroom/provider-vgd';

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

import { describe, it, expect } from 'vitest';

import {
  MEDIA_TABS,
  SORTED_MEDIA_TABS,
  MEDIA_SECTION_ORDER,
  MEDIA_SECTION_LABELS,
  providerIdentifier,
  type StudioBadge,
} from './media-tools.nav';

// Badges are duplicated onto MEDIA_TABS on purpose: reading them from the
// descriptors at runtime would pull ~125KB of model/field catalogs into the
// /media entry chunk to get three strings per studio, and the provider catalog
// can't supply them (kling and pika are both provider `fal`, so they'd get
// identical chips). The duplication is safe only because this spec fails the
// moment the two disagree — a test can afford the heavy import.
import { azureDescriptor } from './azure/descriptor';
import { bedrockDescriptor } from './bedrock/descriptor';
import { blackForestLabsDescriptor } from './black-forest-labs/descriptor';
import { deepgramDescriptor } from './deepgram/descriptor';
import { deepinfraDescriptor } from './deepinfra/descriptor';
import { didDescriptor } from './did/descriptor';
import { elevenlabsDescriptor } from './elevenlabs/descriptor';
import { fireworksDescriptor } from './fireworks/descriptor';
import { gatewayDescriptor } from './gateway/descriptor';
import { genviralDescriptor } from './genviral/descriptor';
import { googleAiDescriptor } from './google-ai/descriptor';
import { groqDescriptor } from './groq/descriptor';
import { hedraDescriptor } from './hedra/descriptor';
import { higgsfieldDescriptor } from './higgsfield/descriptor';
import { ideogramDescriptor } from './ideogram/descriptor';
import { klingDescriptor } from './kling/descriptor';
import { leonardoDescriptor } from './leonardo/descriptor';
import { ltxDescriptor } from './ltx/descriptor';
import { lumaDescriptor } from './luma/descriptor';
import { minimaxDescriptor } from './minimax/descriptor';
import { openaiDescriptor } from './openai/descriptor';
import { openrouterDescriptor } from './openrouter/descriptor';
import { pikaDescriptor } from './pika/descriptor';
import { qwenDescriptor } from './qwen/descriptor';
import { recraftDescriptor } from './recraft/descriptor';
import { reelfarmDescriptor } from './reelfarm/descriptor';
import { runwayDescriptor } from './runway/descriptor';
import { siliconflowDescriptor } from './siliconflow/descriptor';
import { soraDescriptor } from './sora/descriptor';
import { stabilityDescriptor } from './stability-ai/descriptor';
import { sunoDescriptor } from './suno/descriptor';
import { tavusDescriptor } from './tavus/descriptor';
import { togetheraiDescriptor } from './togetherai/descriptor';
import { vertexDescriptor } from './vertex/descriptor';
import { wanDescriptor } from './wan/descriptor';
import { xaiDescriptor } from './xai/descriptor';

// The two bespoke studios have no descriptor; their landing copy lives in a
// pure-data module precisely so this spec can reach it.
import { HEYGEN_LANDING } from './heygen/landing';
import { REPLICATE_LANDING } from './replicate/landing';

/** Route slug -> the landing object that owns the canonical badge list. */
const LANDINGS: Record<string, { badges?: string[] } | undefined> = {
  azure: azureDescriptor.landing,
  bedrock: bedrockDescriptor.landing,
  'black-forest-labs': blackForestLabsDescriptor.landing,
  deepgram: deepgramDescriptor.landing,
  deepinfra: deepinfraDescriptor.landing,
  did: didDescriptor.landing,
  elevenlabs: elevenlabsDescriptor.landing,
  fireworks: fireworksDescriptor.landing,
  gateway: gatewayDescriptor.landing,
  genviral: genviralDescriptor.landing,
  'google-ai': googleAiDescriptor.landing,
  groq: groqDescriptor.landing,
  hedra: hedraDescriptor.landing,
  heygen: HEYGEN_LANDING,
  higgsfield: higgsfieldDescriptor.landing,
  ideogram: ideogramDescriptor.landing,
  kling: klingDescriptor.landing,
  leonardo: leonardoDescriptor.landing,
  ltx: ltxDescriptor.landing,
  luma: lumaDescriptor.landing,
  minimax: minimaxDescriptor.landing,
  openai: openaiDescriptor.landing,
  openrouter: openrouterDescriptor.landing,
  pika: pikaDescriptor.landing,
  qwen: qwenDescriptor.landing,
  recraft: recraftDescriptor.landing,
  reelfarm: reelfarmDescriptor.landing,
  replicate: REPLICATE_LANDING,
  runway: runwayDescriptor.landing,
  siliconflow: siliconflowDescriptor.landing,
  sora: soraDescriptor.landing,
  'stability-ai': stabilityDescriptor.landing,
  suno: sunoDescriptor.landing,
  tavus: tavusDescriptor.landing,
  togetherai: togetheraiDescriptor.landing,
  vertex: vertexDescriptor.landing,
  wan: wanDescriptor.landing,
  xai: xaiDescriptor.landing,
};

const slug = (href: string) => href.replace('/media/', '');
const providers = MEDIA_TABS.filter((t) => t.section === 'Providers');

describe('MEDIA_TABS composition', () => {
  // These counts are the ones AGENTS.md states; if a tool is added or removed,
  // that doc has to move in the same change.
  it('holds all 46 media tools', () => {
    expect(MEDIA_TABS).toHaveLength(46);
  });

  it.each([
    ['Platform', 2],
    ['Providers', 38],
    ['Content Pack', 6],
  ])('has %i %s tools', (section, count) => {
    expect(MEDIA_TABS.filter((t) => t.section === section)).toHaveLength(count as number);
  });

  it('uses only known sections, all of which have a display label', () => {
    for (const tab of MEDIA_TABS) {
      expect(MEDIA_SECTION_ORDER).toContain(tab.section);
      expect(MEDIA_SECTION_LABELS[tab.section]).toBeTruthy();
    }
  });

  it('has unique hrefs, all under /media/', () => {
    const hrefs = MEDIA_TABS.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith('/media/')).toBe(true);
  });

  it('sorts by section then label, once, at module scope', () => {
    expect(SORTED_MEDIA_TABS).toHaveLength(MEDIA_TABS.length);
    const rank = SORTED_MEDIA_TABS.map((t) => MEDIA_SECTION_ORDER.indexOf(t.section));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
  });
});

describe('provider studio badges', () => {
  it('every provider studio declares badges', () => {
    for (const tab of providers) {
      expect(tab.badges, `${tab.href} has no badges`).toBeTruthy();
      expect(tab.badges!.length).toBeGreaterThan(0);
    }
  });

  it.each(providers.map((t) => [slug(t.href), t] as const))(
    '%s badges match its landing copy',
    (id, tab) => {
      const landing = LANDINGS[id];
      expect(landing, `no landing registered for ${id}`).toBeTruthy();
      expect(tab.badges).toEqual(landing!.badges);
    }
  );

  it('keeps kling and pika independent even though both are provider "fal"', () => {
    // This is the case that rules out deriving chips from the provider catalog,
    // which is keyed by provider id and would give the two identical chips.
    expect(providerIdentifier('/media/kling')).toBe('fal');
    expect(providerIdentifier('/media/pika')).toBe('fal');
    const kling = MEDIA_TABS.find((t) => t.href === '/media/kling');
    const pika = MEDIA_TABS.find((t) => t.href === '/media/pika');
    expect(kling!.badges).toEqual(klingDescriptor.landing!.badges);
    expect(pika!.badges).toEqual(pikaDescriptor.landing!.badges);
  });

  it('only uses the eight known badge values', () => {
    const known: StudioBadge[] = [
      'Image', 'Video', 'Audio', 'Avatar', 'Voice', 'Vector', 'Music', 'Transcription',
    ];
    for (const tab of providers) {
      for (const badge of tab.badges!) expect(known).toContain(badge);
    }
  });

  it('gives non-provider tools no badges', () => {
    for (const tab of MEDIA_TABS.filter((t) => t.section !== 'Providers')) {
      expect(tab.badges).toBeUndefined();
    }
  });
});

describe('providerIdentifier', () => {
  it('maps the four routes that ride another provider’s credentials', () => {
    expect(providerIdentifier('/media/google-ai')).toBe('google');
    expect(providerIdentifier('/media/sora')).toBe('openai');
    expect(providerIdentifier('/media/kling')).toBe('fal');
    expect(providerIdentifier('/media/pika')).toBe('fal');
  });

  it('passes every other studio route through unchanged', () => {
    expect(providerIdentifier('/media/luma')).toBe('luma');
    expect(providerIdentifier('/media/heygen')).toBe('heygen');
  });

  it('resolves every provider route to a non-empty identifier', () => {
    for (const tab of providers) {
      expect(providerIdentifier(tab.href)).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

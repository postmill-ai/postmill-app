import type { StudioDescriptor, StudioLanding, StudioTab } from './types';
import { studioNs } from './i18n-keys';
import { azureDescriptor } from '../azure/descriptor';
import { bedrockDescriptor } from '../bedrock/descriptor';
import { blackForestLabsDescriptor } from '../black-forest-labs/descriptor';
import { deepgramDescriptor } from '../deepgram/descriptor';
import { deepinfraDescriptor } from '../deepinfra/descriptor';
import { didDescriptor } from '../did/descriptor';
import { elevenlabsDescriptor } from '../elevenlabs/descriptor';
import { fireworksDescriptor } from '../fireworks/descriptor';
import { gatewayDescriptor } from '../gateway/descriptor';
import { genviralDescriptor } from '../genviral/descriptor';
import { googleAiDescriptor } from '../google-ai/descriptor';
import { groqDescriptor } from '../groq/descriptor';
import { hedraDescriptor } from '../hedra/descriptor';
import { higgsfieldDescriptor } from '../higgsfield/descriptor';
import { ideogramDescriptor } from '../ideogram/descriptor';
import { klingDescriptor } from '../kling/descriptor';
import { leonardoDescriptor } from '../leonardo/descriptor';
import { ltxDescriptor } from '../ltx/descriptor';
import { lumaDescriptor } from '../luma/descriptor';
import { minimaxDescriptor } from '../minimax/descriptor';
import { openaiDescriptor } from '../openai/descriptor';
import { openrouterDescriptor } from '../openrouter/descriptor';
import { pikaDescriptor } from '../pika/descriptor';
import { qwenDescriptor } from '../qwen/descriptor';
import { recraftDescriptor } from '../recraft/descriptor';
import { reelfarmDescriptor } from '../reelfarm/descriptor';
import { runwayDescriptor } from '../runway/descriptor';
import { siliconflowDescriptor } from '../siliconflow/descriptor';
import { stabilityDescriptor } from '../stability-ai/descriptor';
import { sunoDescriptor } from '../suno/descriptor';
import { tavusDescriptor } from '../tavus/descriptor';
import { togetheraiDescriptor } from '../togetherai/descriptor';
import { vertexDescriptor } from '../vertex/descriptor';
import { wanDescriptor } from '../wan/descriptor';
import { xaiDescriptor } from '../xai/descriptor';

// Static provider → descriptor map for the embeddable CompactStudio. Every
// studio-kit descriptor is importable here; bespoke studios (HeyGen, Replicate)
// ship no descriptor and are handled separately below.
const ALL_DESCRIPTORS: StudioDescriptor[] = [
  azureDescriptor,
  bedrockDescriptor,
  blackForestLabsDescriptor,
  deepgramDescriptor,
  deepinfraDescriptor,
  didDescriptor,
  elevenlabsDescriptor,
  fireworksDescriptor,
  gatewayDescriptor,
  genviralDescriptor,
  googleAiDescriptor,
  groqDescriptor,
  hedraDescriptor,
  higgsfieldDescriptor,
  ideogramDescriptor,
  klingDescriptor,
  leonardoDescriptor,
  ltxDescriptor,
  lumaDescriptor,
  minimaxDescriptor,
  openaiDescriptor,
  openrouterDescriptor,
  pikaDescriptor,
  qwenDescriptor,
  recraftDescriptor,
  reelfarmDescriptor,
  runwayDescriptor,
  siliconflowDescriptor,
  stabilityDescriptor,
  sunoDescriptor,
  tavusDescriptor,
  togetheraiDescriptor,
  vertexDescriptor,
  wanDescriptor,
  xaiDescriptor,
];

export type CompactOperation = 'image' | 'video' | 'audio';

// The finished asset a compact studio hands back to the hosting dialog.
export interface CompactStudioResult {
  operation: CompactOperation;
  artifactUrl: string;
  fileId: string;
}

export interface CompactTab {
  // Unique within the entry — colliding providers (Kling + Pika both ride the
  // `fal` credential) merge their tabs, so a repeated tab
  // key is suffixed with the source studio's title.
  key: string;
  // i18n namespace of the SOURCE descriptor (provider + title, see i18n-keys.ts)
  // — merged tabs keep their own studio's translation keys.
  ns: string;
  tab: StudioTab;
}

export interface CompactStudioEntry {
  provider: string;
  title: string;
  landing?: StudioLanding;
  tabs: CompactTab[];
}

const slug = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function buildRegistry(): Record<string, CompactStudioEntry> {
  const byProvider = new Map<string, StudioDescriptor[]>();
  for (const d of ALL_DESCRIPTORS) {
    const list = byProvider.get(d.provider);
    if (list) list.push(d);
    else byProvider.set(d.provider, [d]);
  }
  const out: Record<string, CompactStudioEntry> = {};
  for (const [provider, descriptors] of byProvider) {
    const seen = new Set<string>();
    const tabs: CompactTab[] = [];
    for (const d of descriptors) {
      const ns = studioNs(d.provider, d.title);
      for (const tab of d.tabs) {
        let key = tab.key;
        if (seen.has(key)) key = `${key}-${slug(d.title)}`;
        seen.add(key);
        tabs.push({ key, ns, tab });
      }
    }
    out[provider] = {
      provider,
      title: descriptors[0].title,
      landing: descriptors[0].landing,
      tabs,
    };
  }
  return out;
}

export const COMPACT_STUDIO_REGISTRY: Record<string, CompactStudioEntry> = buildRegistry();

// Providers with a bespoke compact studio (no descriptor). Currently Replicate
// (model-picker/dynamic-form embed) and HeyGen (talking-photo avatar embed).
export const BESPOKE_COMPACT_PROVIDERS: readonly string[] = ['replicate', 'heygen'];

// The avatar dialog embeds descriptor studios via their `video` tabs — but only
// when the tab is actually an avatar tool. Reel.Farm's video tab is a slideshow
// generator whose prompt semantics ("describe your slideshow") clash with the
// dialog's script textarea, so it is excluded even though it embeds technically.
const AVATAR_COMPACT_EXCLUDE: readonly string[] = ['reelfarm'];

/**
 * Does this provider have an embeddable studio for the given operation?
 * Descriptor providers need at least one non-`custom` tab for the operation
 * (custom panels like Deepgram's transcription UI are not embeddable).
 * `'avatar'` maps onto the provider's `video` tabs (minus AVATAR_COMPACT_EXCLUDE).
 */
export function hasCompactStudio(
  provider: string,
  operation?: CompactOperation | 'avatar'
): boolean {
  if (BESPOKE_COMPACT_PROVIDERS.includes(provider)) return true;
  const entry = COMPACT_STUDIO_REGISTRY[provider];
  if (!entry) return false;
  if (!operation) return entry.tabs.some(({ tab }) => !tab.custom);
  if (operation === 'avatar') {
    if (AVATAR_COMPACT_EXCLUDE.includes(provider)) return false;
    return entry.tabs.some(({ tab }) => !tab.custom && tab.operation === 'video');
  }
  return entry.tabs.some(({ tab }) => !tab.custom && tab.operation === operation);
}

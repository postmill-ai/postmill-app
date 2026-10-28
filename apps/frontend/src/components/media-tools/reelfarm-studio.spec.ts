import { describe, expect, it } from 'vitest';
import en from '@postmill-ai/react/translation/locales/en/translation.json';
import { reelfarmDescriptor } from './reelfarm/descriptor';
import {
  studioFieldKey,
  studioLandingDescKey,
  studioLandingHighlightKey,
  studioNs,
  studioTabDescKey,
} from './studio-kit/i18n-keys';

const locale: Record<string, string> = en;
const ns = studioNs(reelfarmDescriptor.provider, reelfarmDescriptor.title);

describe('Reel.Farm studio locale registry', () => {
  it('keeps English landing copy and highlight count aligned with the descriptor', () => {
    const landing = reelfarmDescriptor.landing!;
    expect(locale[studioLandingDescKey(ns)]).toBe(landing.description);
    expect(landing.highlights).toHaveLength(5);

    const highlightKeys = Object.keys(locale).filter((key) =>
      key.startsWith(`${ns}_landing_hl`)
    );
    expect(highlightKeys).toHaveLength(landing.highlights.length);
    for (const [index, highlight] of landing.highlights.entries()) {
      expect(locale[studioLandingHighlightKey(ns, index)]).toBe(highlight);
    }
  });

  it('keeps the tab description and local-conversion help aligned with the descriptor', () => {
    const tab = reelfarmDescriptor.tabs.find(({ key }) => key === 'slideshow')!;
    expect(locale[studioTabDescKey(ns, tab.key)]).toBe(tab.description);

    for (const name of ['aspect_ratio', 'keep_original_aspect_ratio', 'duration']) {
      const field = tab.fields.find((candidate) => candidate.name === name)!;
      expect(field.help).toBeDefined();
      expect(locale[studioFieldKey(ns, tab.key, name, 'help')]).toBe(field.help);
    }
  });
});

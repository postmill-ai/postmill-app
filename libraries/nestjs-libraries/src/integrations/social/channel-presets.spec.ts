import { describe, expect, it } from 'vitest';
import { CHANNEL_PRESETS } from './channel-presets';

describe('channel format presets', () => {
  it.each([
    ['ig-portrait', 'instagram'],
    ['fb-portrait', 'facebook'],
    ['linkedin-portrait', 'linkedin'],
    ['threads-portrait', 'threads'],
  ])('provides the 1080x1350 %s preset with safe zones', (id, provider) => {
    const preset = CHANNEL_PRESETS.find((candidate) => candidate.id === id);
    expect(preset).toMatchObject({
      width: 1080,
      height: 1350,
      category: 'social',
      provider,
    });
    expect(preset?.safeZones?.length).toBeGreaterThan(0);
    for (const zone of preset?.safeZones ?? []) {
      expect(zone.x).toBeGreaterThanOrEqual(0);
      expect(zone.y).toBeGreaterThanOrEqual(0);
      expect(zone.x + zone.width).toBeLessThanOrEqual(1080);
      expect(zone.y + zone.height).toBeLessThanOrEqual(1350);
    }
  });

  it.each(['fb-square', 'linkedin-square'])(
    'provides the %s 1080x1080 preset with safe zones',
    (id) => {
      const preset = CHANNEL_PRESETS.find((candidate) => candidate.id === id);
      expect(preset).toMatchObject({ width: 1080, height: 1080, category: 'social' });
      expect(preset?.safeZones?.length).toBeGreaterThan(0);
    }
  );

  it('keeps one existing YouTube Short preset', () => {
    expect(CHANNEL_PRESETS.filter((preset) => preset.id === 'short')).toHaveLength(1);
    expect(CHANNEL_PRESETS.find((preset) => preset.id === 'short')).toMatchObject({
      name: 'YouTube Short', width: 1080, height: 1920, category: 'video',
    });
  });
});

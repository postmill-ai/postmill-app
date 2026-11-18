import { describe, expect, it } from 'vitest';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { getSafeZoneOverlays } from './safe-zones';

describe('getSafeZoneOverlays', () => {
  it.each(CHANNEL_PRESETS.map((preset) => [preset.id] as const))(
    'scales every zone of %s at reference, enlarged, reduced, and custom dimensions',
    (id) => {
      const preset = CHANNEL_PRESETS.find((candidate) => candidate.id === id)!;
      const dimensions = [
        { width: preset.width, height: preset.height },
        { width: preset.width * 2, height: preset.height * 2 },
        { width: preset.width / 2, height: preset.height / 2 },
        { width: 777, height: 1333 },
      ];

      for (const size of dimensions) {
        const zones = getSafeZoneOverlays(id, size.width, size.height);
        if (!preset.safeZones?.length) {
          expect(zones).toEqual([{
            kind: 'title-safe',
            label: 'Title Safe (5%)',
            x: size.width * 0.05,
            y: size.height * 0.05,
            width: size.width * 0.9,
            height: size.height * 0.9,
            description: 'Generic title-safe area',
          }]);
          continue;
        }

        expect(zones).toHaveLength(preset.safeZones.length);
        zones.forEach((zone, index) => {
          const source = preset.safeZones![index];
          expect(zone.kind).toBe('obstruction');
          expect(zone.label).toBe(source.label);
          expect(zone.x).toBeCloseTo(source.x * size.width / preset.width, 8);
          expect(zone.y).toBeCloseTo(source.y * size.height / preset.height, 8);
          expect(zone.width).toBeCloseTo(source.width * size.width / preset.width, 8);
          expect(zone.height).toBeCloseTo(source.height * size.height / preset.height, 8);
        });
      }
    }
  );

  it('covers the full enlarged Instagram Story top and bottom UI', () => {
    const zones = getSafeZoneOverlays('ig-story', 2118, 3763);
    const top = zones.find((zone) => zone.label === 'Top UI')!;
    const bottom = zones.find((zone) => zone.label === 'CTA Bar')!;

    expect(top.width).toBeCloseTo(2118, 8);
    expect(top.height).toBeCloseTo(80 * 3763 / 1920, 8);
    expect(bottom.x).toBe(0);
    expect(bottom.width).toBeCloseTo(2118, 8);
    expect(bottom.y + bottom.height).toBeCloseTo(3763, 8);
  });

  it.each([
    ['ig-reel', 'Action Rail'],
    ['reel', 'Action Rail'],
    ['tiktok', 'Action Rail'],
    ['tiktok-video', 'Action Rail'],
    ['fb-story', 'Profile and System UI'],
    ['linkedin-banner', 'Profile Photo'],
    ['yt-thumbnail', 'Duration Timestamp'],
    ['pinterest-pin', 'Save and More Actions'],
  ])('%s includes %s', (id, label) => {
    expect(getSafeZoneOverlays(id, 1080, 1920).some((zone) => zone.label === label)).toBe(true);
  });

  it('keeps the generic fallback for an unknown custom format', () => {
    expect(getSafeZoneOverlays('unknown-custom', 320, 200)).toEqual([
      expect.objectContaining({
        kind: 'title-safe', x: 16, y: 10, width: 288, height: 180,
      }),
    ]);
  });
});

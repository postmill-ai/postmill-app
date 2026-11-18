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

  it('keeps every platform obstruction inside its reference canvas', () => {
    for (const preset of CHANNEL_PRESETS) {
      for (const zone of preset.safeZones ?? []) {
        expect(zone.x, `${preset.id} ${zone.label} x`).toBeGreaterThanOrEqual(0);
        expect(zone.y, `${preset.id} ${zone.label} y`).toBeGreaterThanOrEqual(0);
        expect(zone.x + zone.width, `${preset.id} ${zone.label} right`).toBeLessThanOrEqual(preset.width);
        expect(zone.y + zone.height, `${preset.id} ${zone.label} bottom`).toBeLessThanOrEqual(preset.height);
      }
    }
  });

  it.each([
    ['ig-reel', 'reel'],
    ['tiktok', 'tiktok-video'],
  ])('keeps static %s and video %s obstruction geometry aligned', (staticId, videoId) => {
    const staticPreset = CHANNEL_PRESETS.find((preset) => preset.id === staticId);
    const videoPreset = CHANNEL_PRESETS.find((preset) => preset.id === videoId);
    expect(videoPreset?.safeZones).toEqual(staticPreset?.safeZones);
  });

  it('models the requested platform UI regions', () => {
    const labels = (id: string) => CHANNEL_PRESETS.find((preset) => preset.id === id)
      ?.safeZones?.map((zone) => zone.label) ?? [];
    expect(labels('fb-story')).toContain('Profile and System UI');
    expect(labels('linkedin-banner')).toContain('Profile Photo');
    expect(labels('yt-thumbnail')).toContain('Duration Timestamp');
    expect(labels('ig-reel')).toContain('Action Rail');
    expect(labels('tiktok')).toContain('Action Rail');
  });

  it('keeps feed regions guide-only and preserves margins for newly zoned real overlays', () => {
    for (const id of ['ig-post', 'fb-post', 'x-post', 'linkedin-post']) {
      expect(CHANNEL_PRESETS.find((preset) => preset.id === id)?.safeZoneLayout).toBe('guide-only');
    }
    for (const id of ['linkedin-banner', 'yt-thumbnail', 'pinterest-pin', 'reel', 'short', 'tiktok-video']) {
      expect(CHANNEL_PRESETS.find((preset) => preset.id === id)?.safeZoneLayout).toBe('preserve-generic-margins');
    }
  });

  it('keeps one existing YouTube Short preset', () => {
    expect(CHANNEL_PRESETS.filter((preset) => preset.id === 'short')).toHaveLength(1);
    expect(CHANNEL_PRESETS.find((preset) => preset.id === 'short')).toMatchObject({
      name: 'YouTube Short', width: 1080, height: 1920, category: 'video',
    });
  });
});

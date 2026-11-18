import {
  CHANNEL_PRESETS,
  type SafeZoneOverlay,
} from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';

export interface ResolvedSafeZoneOverlay extends SafeZoneOverlay {
  kind: 'obstruction' | 'title-safe';
}

export const getSafeZoneOverlays = (
  formatId: string | undefined,
  width: number,
  height: number
): ResolvedSafeZoneOverlay[] => {
  const preset = CHANNEL_PRESETS.find((candidate) => candidate.id === formatId);
  if (!preset?.safeZones?.length) {
    return [{
      kind: 'title-safe',
      label: 'Title Safe (5%)',
      x: width * 0.05,
      y: height * 0.05,
      width: width * 0.9,
      height: height * 0.9,
      description: 'Generic title-safe area',
    }];
  }

  const scaleX = width / preset.width;
  const scaleY = height / preset.height;
  return preset.safeZones.map((zone) => ({
    ...zone,
    kind: 'obstruction',
    x: zone.x * scaleX,
    y: zone.y * scaleY,
    width: zone.width * scaleX,
    height: zone.height * scaleY,
  }));
};

/** Guide-only regions are canvas decoration, not constraints or review input. */
export const getEnforcedSafeZones = (
  formatId: string | undefined,
  width: number,
  height: number
): ResolvedSafeZoneOverlay[] => {
  const preset = CHANNEL_PRESETS.find((candidate) => candidate.id === formatId);
  return getSafeZoneOverlays(
    preset?.safeZoneLayout === 'guide-only' ? undefined : formatId,
    width,
    height
  );
};

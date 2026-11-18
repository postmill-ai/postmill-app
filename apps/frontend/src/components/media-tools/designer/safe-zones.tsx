'use client';

import React, { FC, useMemo } from 'react';
import { Group, Label, Rect, Tag, Text } from 'react-konva';
import { getSafeZoneOverlays } from '@postmill-ai/nestjs-libraries/media/designer-doc/safe-zones';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

interface SafeZoneOverlayProps {
  presetId?: string;
  width: number;
  height: number;
  visible: boolean;
  zoom: number;
}

export const SafeZoneOverlay: FC<SafeZoneOverlayProps> = ({
  presetId,
  width,
  height,
  visible,
  zoom,
}) => {
  const t = useT();
  const zones = useMemo(
    () => presetId ? getSafeZoneOverlays(presetId, width, height) : [],
    [presetId, width, height]
  );

  if (!visible || !presetId) return null;

  const fontSize = 12 / zoom;
  const padding = 4 / zoom;
  const hasObstructions = zones.some((zone) => zone.kind === 'obstruction');

  return (
    <>
      {zones.map((zone, index) => (
        <Group key={`${zone.label}-${index}`} name="safe-zone" listening={false}>
          <Rect
            name={`safe-zone-${zone.kind}`}
            x={zone.x}
            y={zone.y}
            width={zone.width}
            height={zone.height}
            fill={zone.kind === 'obstruction' ? 'rgba(255, 0, 0, 0.10)' : undefined}
            stroke={zone.kind === 'obstruction' ? 'rgba(255, 0, 0, 0.65)' : 'rgba(120, 130, 150, 0.8)'}
            strokeWidth={1 / zoom}
            dash={[4 / zoom, 4 / zoom]}
            listening={false}
          />
          <Label
            x={zone.x + padding}
            y={zone.y + padding}
            name="safe-zone-label"
            listening={false}
          >
            <Tag fill="rgba(24, 28, 38, 0.88)" cornerRadius={3 / zoom} />
            <Text
              text={zone.kind === 'title-safe'
                ? t('title_safe_5_percent', 'Title Safe (5%)')
                : zone.label}
              fontSize={fontSize}
              padding={padding}
              width={160 / zoom}
              wrap="word"
              fill="#ffffff"
              fontFamily="Arial"
              listening={false}
            />
          </Label>
        </Group>
      ))}
      {hasObstructions && (
        <Group
          x={8 / zoom}
          y={8 / zoom}
          name="safe-zone-legend"
          listening={false}
        >
          <Rect
            width={12 / zoom}
            height={12 / zoom}
            fill="rgba(255, 0, 0, 0.35)"
            stroke="rgba(255, 0, 0, 0.8)"
            strokeWidth={1 / zoom}
            listening={false}
          />
          <Label x={18 / zoom} y={-4 / zoom} listening={false}>
            <Tag fill="rgba(24, 28, 38, 0.88)" cornerRadius={3 / zoom} />
            <Text
              text={t(
                'safe_zone_shaded_approximate',
                'Shaded = may be covered · Platform UI is approximate'
              )}
              fontSize={fontSize}
              padding={padding}
              width={Math.min(320 / zoom, Math.max(1, width - 36 / zoom))}
              wrap="word"
              fill="#ffffff"
              fontFamily="Arial"
              listening={false}
            />
          </Label>
        </Group>
      )}
    </>
  );
};

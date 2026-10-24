'use client';

import React, { FC, useState } from 'react';
import clsx from 'clsx';
import { useMediaDirectory } from '@postmill-ai/react/helpers/use.media.directory';
import type { FileItem } from './file-manager';
import { formatVideoDuration, getFilePresentation } from './file-presentation';

export const VideoDurationBadge: FC<{ file: FileItem; compact?: boolean }> = ({ file, compact }) => {
  const mediaDirectory = useMediaDirectory();
  const presentation = getFilePresentation(file);
  const metadataDuration = formatVideoDuration(file.metadata?.durationMs);
  const probeKey = `${file.id}:${file.path}:${String(file.metadata?.durationMs)}`;
  const [probed, setProbed] = useState<{ key: string; duration: string | null } | null>(null);
  const duration = metadataDuration || (probed?.key === probeKey ? probed.duration : null);

  if (!presentation.hasVideoDuration) return null;

  return (
    <>
      {presentation.mediaKind === 'video' && !metadataDuration && (
        <video
          aria-hidden="true"
          className="hidden"
          src={mediaDirectory.set(file.path)}
          preload="metadata"
          onLoadedMetadata={(event) => {
            setProbed({ key: probeKey, duration: formatVideoDuration(event.currentTarget.duration * 1000) });
          }}
          onError={() => setProbed({ key: probeKey, duration: null })}
        >
          <track kind="captions" default />
        </video>
      )}
      {duration && (
        <span
          data-testid="video-duration-badge"
          className={clsx(
            'absolute bottom-[4px] end-[4px] rounded-[4px] bg-black/75 text-white pointer-events-none',
            compact ? 'px-[3px] py-px text-[9px] leading-[13px]' : 'px-[6px] py-[2px] text-[11px] leading-[15px]'
          )}
        >
          {duration}
        </span>
      )}
    </>
  );
};

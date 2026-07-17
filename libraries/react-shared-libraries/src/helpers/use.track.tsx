'use client';

import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';

/**
 * Tracking hook. Accept the user object as an argument to avoid importing the
 * frontend app's user context into shared libraries (breaks the
 * react-shared-libraries -> apps/frontend cycle).
 */
export const useTrack = (user?: { id?: string } | null) => {
  const fetch = useFetch();
  const { facebookPixel } = useVariables();
  return useCallback(
    async (track: TrackEnum, additional?: Record<string, any>) => {
      if (!facebookPixel) {
        return;
      }
      try {
        const { track: uq } = await (
          await fetch(user?.id ? `/user/t` : `/public/t`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tt: track,
              ...(additional
                ? {
                    additional,
                  }
                : {}),
            }),
          })
        ).json();
        if (window.fbq) {
          // @ts-ignore
          window.fbq('track', TrackEnum[track], additional, {
            eventID: uq,
          });
        }
      } catch (e) {
        // Silently ignore tracking errors so they never break the UI.
      }
    },
    [user, fetch, facebookPixel]
  );
};

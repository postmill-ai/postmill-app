'use client';

import React from 'react';
import { MagicGrabDialog } from './magic-grab-dialog';
import {
  cleanupMagicGrabCandidate,
  type StaticMagicGrabCandidate,
  type ClipMagicGrabCandidate,
} from './magic-grab';

type Candidate = StaticMagicGrabCandidate | ClipMagicGrabCandidate;
type Modals = ReturnType<typeof import('@postmill-ai/frontend/components/layout/new-modal').useModals>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const openMagicGrabReview = ({
  modals,
  title,
  fetch,
  candidate,
  onApply,
}: {
  modals: Modals;
  title: string;
  fetch: FetchLike;
  candidate: Candidate;
  onApply: () => Promise<boolean>;
}): void => {
  let applied = false;
  modals.openModal({
    title,
    size: 900,
    onClose: () => {
      if (!applied) void cleanupMagicGrabCandidate(fetch, candidate);
    },
    children: (close: () => void) => (
      <MagicGrabDialog
        originalUrl={candidate.source.url}
        subjectUrl={candidate.asset.url}
        backgroundUrl={candidate.background.url}
        onCancel={close}
        onApply={async () => {
          const result = await onApply();
          if (result) {
            applied = true;
            close();
          }
          return result;
        }}
      />
    ),
  });
};

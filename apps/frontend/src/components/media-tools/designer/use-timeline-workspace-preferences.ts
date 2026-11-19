'use client';

import { useEffect, useRef } from 'react';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import {
  readTimelineWorkspacePreference,
  writeTimelineWorkspacePreference,
} from './timeline-workspace';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

export const useTimelineWorkspacePreferences = (store: Store, mobile: boolean) => {
  const orgId = useUser()?.orgId;
  const density = store((state) => state.timelineDensity);
  const height = store((state) => state.timelineHeight);
  const collapsedTrackIds = store((state) => state.collapsedTimelineTrackIds);
  const timelineCollapsed = store((state) => state.timelineCollapsed);
  const context = `${orgId || ''}:${mobile ? 'mobile' : 'desktop'}`;
  const hydratedContextRef = useRef<string | null>(null);
  const skipWriteRef = useRef(false);

  useEffect(() => {
    skipWriteRef.current = true;
    const preference = readTimelineWorkspacePreference(localStorage, orgId, mobile);
    const state = store.getState();
    state.setTimelineDensity(preference.density);
    state.setTimelineHeight(preference.height);
    state.setCollapsedTimelineTrackIds(preference.collapsedTrackIds);
    state.setTimelineCollapsed(preference.timelineCollapsed);
    hydratedContextRef.current = context;
  }, [store, orgId, mobile, context]);

  useEffect(() => {
    if (hydratedContextRef.current !== context) return;
    if (skipWriteRef.current) {
      skipWriteRef.current = false;
      return;
    }
    writeTimelineWorkspacePreference(localStorage, orgId, {
      density,
      height,
      collapsedTrackIds,
      timelineCollapsed,
    }, mobile);
  }, [
    collapsedTrackIds,
    context,
    density,
    height,
    mobile,
    orgId,
    timelineCollapsed,
  ]);
};

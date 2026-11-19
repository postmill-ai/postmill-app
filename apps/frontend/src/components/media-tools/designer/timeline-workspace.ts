import type { DesignerState, VideoTrack } from './designer.store';

export const MIN_TIMELINE_HEIGHT = 120;
export const MAX_TIMELINE_HEIGHT = 600;
export const DEFAULT_TIMELINE_HEIGHT = 240;
export const MIN_TIMELINE_CANVAS_HEIGHT = 240;
export const COLLAPSED_TIMELINE_TRACK_HEIGHT = 28;

export const TIMELINE_DENSITY_LAYOUT = {
  comfortable: { trackHeight: 52, trackGap: 4, clipTop: 20 },
  compact: { trackHeight: 36, trackGap: 2, clipTop: 16 },
} as const;

export interface TimelineWorkspacePreference {
  density: DesignerState['timelineDensity'];
  height: number;
  collapsedTrackIds: string[];
  timelineCollapsed: boolean;
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const preferenceKey = (orgId?: string | null) =>
  `designer-video-timeline${orgId ? `-${orgId}` : ''}`;

export const defaultTimelineWorkspacePreference = (
  mobile = false
): TimelineWorkspacePreference => ({
  density: 'comfortable',
  height: DEFAULT_TIMELINE_HEIGHT,
  collapsedTrackIds: [],
  timelineCollapsed: mobile,
});

const validCollapsedIds = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string'))].slice(0, 40)
    : undefined;

export const timelineWorkspaceHeightBounds = (availableHeight: number) => ({
  min: MIN_TIMELINE_HEIGHT,
  max: Number.isFinite(availableHeight) && availableHeight > 0
    ? Math.max(
        MIN_TIMELINE_HEIGHT,
        Math.min(MAX_TIMELINE_HEIGHT, Math.floor(availableHeight - MIN_TIMELINE_CANVAS_HEIGHT))
      )
    : MAX_TIMELINE_HEIGHT,
});

export const clampTimelineWorkspaceHeight = (
  height: number,
  availableHeight: number
): number => {
  const bounds = timelineWorkspaceHeightBounds(availableHeight);
  const requested = Number.isFinite(height) ? Math.round(height) : DEFAULT_TIMELINE_HEIGHT;
  return Math.max(bounds.min, Math.min(bounds.max, requested));
};

export const timelineTrackHeights = (
  tracks: Pick<VideoTrack, 'id'>[],
  density: DesignerState['timelineDensity'],
  collapsedTrackIds: string[]
): number[] => {
  const collapsed = new Set(collapsedTrackIds);
  const height = TIMELINE_DENSITY_LAYOUT[density].trackHeight;
  return tracks.map((track) => collapsed.has(track.id) ? COLLAPSED_TIMELINE_TRACK_HEIGHT : height);
};

export const readTimelineWorkspacePreference = (
  storage: Pick<Storage, 'getItem'>,
  orgId: string | null | undefined,
  mobile = false
): TimelineWorkspacePreference => {
  const defaults = defaultTimelineWorkspacePreference(mobile);
  try {
    const saved = JSON.parse(storage.getItem(preferenceKey(orgId)) || 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    return {
      density: saved.density === 'compact' || saved.density === 'comfortable'
        ? saved.density
        : defaults.density,
      height: typeof saved.height === 'number' && Number.isFinite(saved.height)
        ? clampTimelineWorkspaceHeight(saved.height, 0)
        : defaults.height,
      collapsedTrackIds: validCollapsedIds(saved.collapsedTrackIds) ?? defaults.collapsedTrackIds,
      timelineCollapsed: typeof saved.timelineCollapsed === 'boolean'
        ? saved.timelineCollapsed
        : defaults.timelineCollapsed,
    };
  } catch {
    return defaults;
  }
};

export const writeTimelineWorkspacePreference = (
  storage: PreferenceStorage,
  orgId: string | null | undefined,
  preference: TimelineWorkspacePreference
) => {
  try {
    storage.setItem(preferenceKey(orgId), JSON.stringify(preference));
  } catch {
    return;
  }
};

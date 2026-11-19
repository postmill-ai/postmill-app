import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampTimelineWorkspaceHeight,
  COLLAPSED_TIMELINE_TRACK_HEIGHT,
  defaultTimelineWorkspacePreference,
  MAX_COLLAPSED_TIMELINE_TRACKS,
  readTimelineWorkspacePreference,
  TIMELINE_DENSITY_LAYOUT,
  timelineTrackHeights,
  timelineWorkspaceHeightBounds,
  writeTimelineWorkspacePreference,
} from './timeline-workspace';

describe('timeline workspace preferences', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to comfortable desktop rows and a collapsed mobile timeline', () => {
    expect(defaultTimelineWorkspacePreference()).toMatchObject({
      density: 'comfortable', height: 240, collapsedTrackIds: [], timelineCollapsed: false,
    });
    expect(readTimelineWorkspacePreference(localStorage, 'org', true).timelineCollapsed).toBe(true);
  });

  it('round-trips preferences per organization', () => {
    writeTimelineWorkspacePreference(localStorage, 'org-a', {
      density: 'compact', height: 320, collapsedTrackIds: ['one', 'two'], timelineCollapsed: false,
    });
    expect(readTimelineWorkspacePreference(localStorage, 'org-a')).toEqual({
      density: 'compact', height: 320, collapsedTrackIds: ['one', 'two'], timelineCollapsed: false,
    });
    expect(readTimelineWorkspacePreference(localStorage, 'org-b')).toEqual(
      defaultTimelineWorkspacePreference()
    );
  });

  it('keeps the mobile collapsed default separate from a desktop visit', () => {
    writeTimelineWorkspacePreference(localStorage, 'org', defaultTimelineWorkspacePreference(false));
    expect(readTimelineWorkspacePreference(localStorage, 'org', false).timelineCollapsed).toBe(false);
    expect(readTimelineWorkspacePreference(localStorage, 'org', true).timelineCollapsed).toBe(true);
    writeTimelineWorkspacePreference(localStorage, 'org', {
      ...defaultTimelineWorkspacePreference(true), timelineCollapsed: false,
    }, true);
    expect(readTimelineWorkspacePreference(localStorage, 'org', true).timelineCollapsed).toBe(false);
    expect(readTimelineWorkspacePreference(localStorage, 'org', false).timelineCollapsed).toBe(false);
  });

  it('bounds collapsed IDs by every permitted output and track', () => {
    const ids = Array.from({ length: MAX_COLLAPSED_TIMELINE_TRACKS + 1 }, (_, index) => `track-${index}`);
    localStorage.setItem('designer-video-timeline-org', JSON.stringify({
      density: 'compact', height: 240, collapsedTrackIds: ids, timelineCollapsed: false,
    }));
    const saved = readTimelineWorkspacePreference(localStorage, 'org');
    expect(saved.collapsedTrackIds).toHaveLength(MAX_COLLAPSED_TIMELINE_TRACKS);
    expect(saved.collapsedTrackIds[0]).toBe('track-0');
    expect(saved.collapsedTrackIds.at(-1)).toBe(`track-${MAX_COLLAPSED_TIMELINE_TRACKS - 1}`);
  });

  it('sanitizes malformed or partial values without disabling the workspace', () => {
    localStorage.setItem('designer-video-timeline-org', '{broken');
    expect(readTimelineWorkspacePreference(localStorage, 'org')).toEqual(
      defaultTimelineWorkspacePreference()
    );
    localStorage.setItem('designer-video-timeline-org', JSON.stringify({
      density: 'invalid', height: 9999, collapsedTrackIds: ['a', 'a', 2], timelineCollapsed: true,
    }));
    expect(readTimelineWorkspacePreference(localStorage, 'org')).toEqual({
      density: 'comfortable', height: 600, collapsedTrackIds: ['a'], timelineCollapsed: true,
    });
  });
});

describe('timeline workspace layout', () => {
  it('uses compact and collapsed heights without changing track identity or order', () => {
    const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(timelineTrackHeights(tracks, 'compact', ['b'])).toEqual([
      TIMELINE_DENSITY_LAYOUT.compact.trackHeight,
      COLLAPSED_TIMELINE_TRACK_HEIGHT,
      TIMELINE_DENSITY_LAYOUT.compact.trackHeight,
    ]);
    expect(timelineTrackHeights(tracks, 'comfortable', [])).toEqual([52, 52, 52]);
  });

  it('reserves canvas space and keeps a usable timeline on short workspaces', () => {
    expect(timelineWorkspaceHeightBounds(900)).toEqual({ min: 120, max: 600 });
    expect(timelineWorkspaceHeightBounds(700)).toEqual({ min: 120, max: 460 });
    expect(timelineWorkspaceHeightBounds(300)).toEqual({ min: 120, max: 120 });
    expect(clampTimelineWorkspaceHeight(590, 700)).toBe(460);
    expect(clampTimelineWorkspaceHeight(20, 700)).toBe(120);
  });
});

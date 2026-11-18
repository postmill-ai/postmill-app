import type {
  VideoClip,
  VideoOutput,
  VideoTrack,
} from './designer-doc.schema';
import {
  MAX_CLIPS_PER_TRACK,
  MAX_TRACKS,
} from './designer-doc.limits';

export type ClipArrangementDirection = 'front' | 'back' | 'forward' | 'backward';

export interface ClipArrangementRef {
  trackId: string;
  clipId: string;
}

export interface ClipArrangementMove extends ClipArrangementRef {
  toTrackId: string;
}

export type ClipArrangementFailure =
  | 'empty'
  | 'unknown-clip'
  | 'audio'
  | 'locked'
  | 'frozen'
  | 'already-front'
  | 'already-back'
  | 'track-limit';

export type ClipArrangementResult =
  | {
      status: 'ok';
      tracks: VideoTrack[];
      moves: ClipArrangementMove[];
    }
  | { status: ClipArrangementFailure };

interface SelectionUnit {
  sourceTrack: VideoTrack;
  selectedClips: VideoClip[];
  wholeTrack: boolean;
}

const visual = (track: VideoTrack) => track.type !== 'audio';

const effectiveEnd = (clip: VideoClip) => clip.endMs + (clip.freezeAtMs || 0);

const collides = (a: VideoClip, b: VideoClip) =>
  a.startMs < effectiveEnd(b) && effectiveEnd(a) > b.startMs;

const canMerge = (unit: SelectionUnit, target: VideoTrack) =>
  !unit.wholeTrack &&
  unit.sourceTrack.id !== target.id &&
  unit.sourceTrack.type === target.type &&
  !target.locked &&
  target.clips.length + unit.selectedClips.length <= MAX_CLIPS_PER_TRACK &&
  unit.selectedClips.every((clip) =>
    target.clips.every((resident) => !collides(clip, resident))
  );

export const planClipArrangement = (
  output: VideoOutput,
  refs: ClipArrangementRef[],
  direction: ClipArrangementDirection,
  createId: () => string
): ClipArrangementResult => {
  if (!refs.length) return { status: 'empty' };
  if (output.frozen) return { status: 'frozen' };

  const selectedByTrack = new Map<string, Set<string>>();
  for (const ref of refs) {
    const track = output.tracks.find((candidate) => candidate.id === ref.trackId);
    if (!track?.clips.some((clip) => clip.id === ref.clipId)) {
      return { status: 'unknown-clip' };
    }
    if (track.type === 'audio') return { status: 'audio' };
    if (track.locked) return { status: 'locked' };
    const clips = selectedByTrack.get(ref.trackId) ?? new Set<string>();
    clips.add(ref.clipId);
    selectedByTrack.set(ref.trackId, clips);
  }

  const selectedTrackIds = new Set(selectedByTrack.keys());
  const selectedIndices = output.tracks.flatMap((track, index) =>
    selectedTrackIds.has(track.id) ? [index] : []
  );
  const remaining: VideoTrack[] = [];
  const units: SelectionUnit[] = [];

  output.tracks.forEach((track) => {
    const selected = selectedByTrack.get(track.id);
    if (!selected) {
      remaining.push(track);
      return;
    }
    const selectedClips = track.clips.filter((clip) => selected.has(clip.id));
    const wholeTrack = selectedClips.length === track.clips.length;
    units.push({ sourceTrack: track, selectedClips, wholeTrack });
    if (!wholeTrack) {
      remaining.push({
        ...track,
        clips: track.clips.filter((clip) => !selected.has(clip.id)),
      });
    }
  });

  const nextUnselected = output.tracks
    .slice(Math.max(...selectedIndices) + 1)
    .find((track) => visual(track) && !selectedTrackIds.has(track.id));
  const previousUnselected = output.tracks
    .slice(0, Math.min(...selectedIndices))
    .reverse()
    .find((track) => visual(track) && !selectedTrackIds.has(track.id));
  const firstRemaining = remaining.find(visual);
  const lastRemaining = [...remaining].reverse().find(visual);

  const anchor =
    direction === 'front'
      ? lastRemaining
      : direction === 'back'
        ? firstRemaining
        : direction === 'forward'
          ? nextUnselected ?? lastRemaining
          : previousUnselected ?? firstRemaining;

  if (!anchor) {
    return {
      status: direction === 'front' || direction === 'forward'
        ? 'already-front'
        : 'already-back',
    };
  }

  const insertAfter = direction === 'front' || direction === 'forward';
  const mergeCandidate = insertAfter ? units[0] : units[units.length - 1];
  const merge = canMerge(mergeCandidate, anchor) ? mergeCandidate : null;
  const insertedUnits = units.filter((unit) => unit !== merge);

  if (remaining.length + insertedUnits.filter((unit) => !unit.wholeTrack).length > MAX_TRACKS) {
    return { status: 'track-limit' };
  }

  const destinations = new Map<SelectionUnit, string>();
  for (const unit of units) {
    destinations.set(
      unit,
      unit.wholeTrack
        ? unit.sourceTrack.id
        : unit === merge
          ? anchor.id
          : createId()
    );
  }

  const tracks = [...remaining];
  if (merge) {
    const anchorIndex = tracks.findIndex((track) => track.id === anchor.id);
    tracks[anchorIndex] = {
      ...anchor,
      clips: [...anchor.clips, ...merge.selectedClips],
    };
  }

  const insertedTracks = insertedUnits.map((unit) =>
    unit.wholeTrack
      ? unit.sourceTrack
      : {
          ...unit.sourceTrack,
          id: destinations.get(unit)!,
          clips: unit.selectedClips,
        }
  );
  const anchorIndex = tracks.findIndex((track) => track.id === anchor.id);
  tracks.splice(insertAfter ? anchorIndex + 1 : anchorIndex, 0, ...insertedTracks);

  const moves = units.flatMap((unit) =>
    unit.selectedClips.map((clip) => ({
      trackId: unit.sourceTrack.id,
      clipId: clip.id,
      toTrackId: destinations.get(unit)!,
    }))
  );

  return { status: 'ok', tracks, moves };
};

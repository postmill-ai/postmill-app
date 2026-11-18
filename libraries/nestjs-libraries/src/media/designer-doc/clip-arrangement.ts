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
  | 'track-limit'
  | 'transition';

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

interface TransitionPair {
  trackId: string;
  from: VideoClip;
  to: VideoClip;
}

const activeTransitionPairs = (tracks: VideoTrack[]): TransitionPair[] => {
  const pairs: TransitionPair[] = [];
  for (const track of tracks) {
    if (track.type === 'audio') continue;
    const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    for (let index = 0; index < sorted.length - 1; index++) {
      const from = sorted[index];
      const to = sorted[index + 1];
      const duration = Math.min(
        from.transitionOut?.durationMs ?? 0,
        to.transitionIn?.durationMs ?? 0
      );
      if (duration > 0 && from.endMs <= to.startMs) {
        pairs.push({ trackId: track.id, from, to });
      }
    }
  }
  return pairs;
};

const transitionPairIds = (tracks: VideoTrack[]) =>
  new Set(activeTransitionPairs(tracks).map((pair) => `${pair.from.id}:${pair.to.id}`));

const sameTransitionPairs = (before: VideoTrack[], after: VideoTrack[]) => {
  const previous = transitionPairIds(before);
  const next = transitionPairIds(after);
  return previous.size === next.size && [...previous].every((pair) => next.has(pair));
};

const refId = (trackId: string, clipId: string) => `${trackId}:${clipId}`;

export const expandClipArrangementRefs = (
  output: VideoOutput,
  refs: ClipArrangementRef[]
): ClipArrangementRef[] => {
  const selected = new Set(refs.map((ref) => refId(ref.trackId, ref.clipId)));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const pair of activeTransitionPairs(output.tracks)) {
      const fromId = refId(pair.trackId, pair.from.id);
      const toId = refId(pair.trackId, pair.to.id);
      if (selected.has(fromId) === selected.has(toId)) continue;
      selected.add(fromId);
      selected.add(toId);
      expanded = true;
    }
  }

  const resolved = output.tracks.flatMap((track) =>
    track.clips.flatMap((clip) =>
      selected.has(refId(track.id, clip.id))
        ? [{ trackId: track.id, clipId: clip.id }]
        : []
    )
  );
  const resolvedIds = new Set(resolved.map((ref) => refId(ref.trackId, ref.clipId)));
  return [
    ...refs.filter((ref) => !resolvedIds.has(refId(ref.trackId, ref.clipId)) &&
      !output.tracks.some((track) => track.id === ref.trackId &&
        track.clips.some((clip) => clip.id === ref.clipId))),
    ...resolved,
  ];
};

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
  const expandedRefs = expandClipArrangementRefs(output, refs);
  for (const ref of expandedRefs) {
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

  if (remaining.length + insertedUnits.length > MAX_TRACKS) {
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

  if (
    tracks.length === output.tracks.length &&
    tracks.every((track, index) => track === output.tracks[index])
  ) {
    return { status: insertAfter ? 'already-front' : 'already-back' };
  }
  if (!sameTransitionPairs(output.tracks, tracks)) {
    return { status: 'transition' };
  }

  const moves = units.flatMap((unit) =>
    unit.selectedClips.map((clip) => ({
      trackId: unit.sourceTrack.id,
      clipId: clip.id,
      toTrackId: destinations.get(unit)!,
    }))
  );

  return { status: 'ok', tracks, moves };
};

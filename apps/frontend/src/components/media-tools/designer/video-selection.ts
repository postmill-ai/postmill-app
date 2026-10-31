import type { VideoOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

export interface VideoClipRef {
  trackId: string;
  clipId: string;
}

const sameRef = (a: VideoClipRef, b: VideoClipRef) =>
  a.trackId === b.trackId && a.clipId === b.clipId;

const uniqueRefs = (refs: VideoClipRef[]) =>
  refs.filter((ref, index) => refs.findIndex((other) => sameRef(ref, other)) === index);

export const groupRefsForClip = (
  output: VideoOutput,
  trackId: string,
  clipId: string
): VideoClipRef[] => {
  const source = output.tracks
    .find((track) => track.id === trackId)
    ?.clips.find((clip) => clip.id === clipId);
  if (!source?.groupId) return [{ trackId, clipId }];
  return output.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clip.groupId === source.groupId)
      .map((clip) => ({ trackId: track.id, clipId: clip.id }))
  );
};

export const expandClipRefs = (
  output: VideoOutput,
  refs: VideoClipRef[]
): VideoClipRef[] =>
  uniqueRefs(refs.flatMap((ref) => groupRefsForClip(output, ref.trackId, ref.clipId)));

export const toggleClipRefs = (
  current: VideoClipRef[],
  members: VideoClipRef[]
): VideoClipRef[] => {
  const allSelected = members.every((member) =>
    current.some((ref) => sameRef(ref, member))
  );
  if (allSelected) {
    return current.filter((ref) => !members.some((member) => sameRef(ref, member)));
  }
  return uniqueRefs([...current, ...members]);
};

export interface MarqueeClip {
  trackId: string;
  clip: { id: string };
  props: { x: number; y: number; width: number; height: number };
}

export const clipsInMarquee = (
  clips: MarqueeClip[],
  marquee: { x: number; y: number; w: number; h: number },
  lockedTrackIds: ReadonlySet<string>
): VideoClipRef[] =>
  clips
    .filter(({ trackId, props }) =>
      !lockedTrackIds.has(trackId) &&
      props.x < marquee.x + marquee.w &&
      props.x + props.width > marquee.x &&
      props.y < marquee.y + marquee.h &&
      props.y + props.height > marquee.y
    )
    .map(({ trackId, clip }) => ({ trackId, clipId: clip.id }));

import type { createDesignerStore } from './designer.store';
import type {
  ClipArrangementDirection,
  ClipArrangementFailure,
  ClipArrangementRef,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/clip-arrangement';
import type { VideoOutput } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';

export const CLIP_ARRANGEMENT_MENU_COMMANDS = [
  { direction: 'front', key: 'designer_action_bring_front_bring_to_front', label: 'Bring to Front' },
  { direction: 'forward', key: 'designer_action_bring_forward_bring_forward', label: 'Bring Forward' },
  { direction: 'backward', key: 'designer_action_send_backward_send_backward', label: 'Send Backward' },
  { direction: 'back', key: 'designer_action_send_back_send_to_back', label: 'Send to Back' },
] as const;

export const CLIP_ARRANGEMENT_INSPECTOR_COMMANDS = [
  { direction: 'back', key: 'designer_send_to_back', label: 'Send to back', shortKey: 'designer_layer_btn_back', shortLabel: '⤒ Back' },
  { direction: 'backward', key: 'designer_send_backward', label: 'Send backward', shortKey: 'designer_layer_btn_bwd', shortLabel: '↓ Bwd' },
  { direction: 'forward', key: 'designer_bring_forward', label: 'Bring forward', shortKey: 'designer_layer_btn_fwd', shortLabel: '↑ Fwd' },
  { direction: 'front', key: 'designer_bring_to_front', label: 'Bring to front', shortKey: 'designer_layer_btn_front', shortLabel: '⤓ Front' },
] as const;

export const clipArrangementRefsForTarget = (
  selectedClips: ClipArrangementRef[],
  target: ClipArrangementRef
): ClipArrangementRef[] =>
  selectedClips.some((ref) =>
    ref.trackId === target.trackId && ref.clipId === target.clipId
  )
    ? selectedClips
    : [target];

export const clipArrangementSelectionFailure = (
  output: VideoOutput,
  refs: ClipArrangementRef[]
): ClipArrangementFailure | null => {
  if (output.frozen) return 'frozen';
  if (!refs.length) return 'empty';
  for (const ref of refs) {
    const track = output.tracks.find((candidate) => candidate.id === ref.trackId);
    if (!track?.clips.some((clip) => clip.id === ref.clipId)) return 'unknown-clip';
    if (track.type === 'audio') return 'audio';
    if (track.locked) return 'locked';
  }
  return null;
};

const failureCopy = (status: ClipArrangementFailure) => {
  switch (status) {
    case 'audio':
      return ['designer_arrange_audio', 'Audio clips do not have visual layer order'] as const;
    case 'locked':
      return ['designer_arrange_locked', 'Unlock every selected track before arranging its clips'] as const;
    case 'frozen':
      return ['designer_arrange_frozen', 'Unfreeze this output before arranging clips'] as const;
    case 'already-front':
      return ['designer_arrange_already_front', 'The selection is already at the front'] as const;
    case 'already-back':
      return ['designer_arrange_already_back', 'The selection is already at the back'] as const;
    case 'track-limit':
      return ['designer_arrange_track_limit', 'The track limit prevents this arrangement'] as const;
    case 'transition':
      return ['designer_arrange_transition', 'This arrangement would change a transition'] as const;
    default:
      return ['designer_arrange_unknown_clip', 'Select a visual clip to arrange'] as const;
  }
};

export const clipArrangementFailureText = (
  status: ClipArrangementFailure,
  translate: (key: string, fallback: string) => string
) => {
  const [key, fallback] = failureCopy(status);
  return translate(key, fallback);
};

export const runClipArrangement = (
  store: ReturnType<typeof createDesignerStore>,
  outputIndex: number,
  refs: ClipArrangementRef[],
  direction: ClipArrangementDirection,
  toaster: { show: (text: string, kind: 'success' | 'warning') => void },
  translate: (key: string, fallback: string) => string
) => {
  const status = store.getState().arrangeVideoClips(outputIndex, refs, direction);
  if (status !== 'ok') {
    toaster.show(clipArrangementFailureText(status, translate), 'warning');
  }
  return status;
};

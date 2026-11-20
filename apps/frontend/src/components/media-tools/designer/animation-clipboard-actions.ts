import type {
  AnimationCopyResult,
  AnimationPasteResult,
  AnimationSkipDetail,
  DesignerStore,
} from './designer.store';
import type { AnimationSkipReason } from '@postmill-ai/nestjs-libraries/media/designer-doc/animation-clipboard';
import { expandClipRefs, type VideoClipRef } from './video-selection';

interface AnimationRef extends VideoClipRef {
  outputIndex: number;
}

type Store = {
  getState: () => DesignerStore;
};

type Translate = (
  key: string,
  fallback: string,
  params?: Record<string, string | number>
) => string;

type Toaster = {
  show: (message: string, type: 'success' | 'warning') => void;
};

const skipLabels: Record<AnimationSkipReason, { key: string; fallback: string }> = {
  audio: { key: 'designer_animation_skip_audio', fallback: 'audio animation' },
  'unsupported-properties': {
    key: 'designer_animation_skip_unsupported',
    fallback: 'unsupported properties',
  },
  'invalid-keyframes': {
    key: 'designer_animation_skip_invalid_keyframes',
    fallback: 'invalid keyframes',
  },
  'keyframe-limit': {
    key: 'designer_animation_skip_keyframe_limit',
    fallback: 'targets above the 1000-keyframe limit',
  },
  'invalid-base': {
    key: 'designer_animation_skip_invalid_base',
    fallback: 'invalid base geometry',
  },
  'invalid-path': {
    key: 'designer_animation_skip_invalid_path',
    fallback: 'invalid motion paths',
  },
  'font-size': {
    key: 'designer_animation_skip_font_size',
    fallback: 'font size on non-text clips',
  },
  'text-reveal': {
    key: 'designer_animation_skip_text_reveal',
    fallback: 'text reveal on non-text clips',
  },
  'audio-clip': {
    key: 'designer_animation_skip_audio_clip',
    fallback: 'audio-only clips',
  },
  locked: { key: 'designer_animation_skip_locked', fallback: 'locked clips' },
  unknown: { key: 'designer_animation_skip_unknown', fallback: 'missing clips' },
  unchanged: { key: 'designer_animation_skip_unchanged', fallback: 'unchanged clips' },
  'no-compatible-animation': {
    key: 'designer_animation_skip_incompatible',
    fallback: 'clips with no compatible animation',
  },
};

const skipSummary = (skipped: AnimationSkipDetail[], t: Translate): string => {
  const reasons = Array.from(new Set(skipped.flatMap((detail) => detail.reasons)))
    .filter((reason) => reason !== 'no-compatible-animation');
  return reasons.map((reason) => {
    const label = skipLabels[reason];
    return t(label.key, label.fallback);
  }).join(', ');
};

export const animationTargetRefs = (
  store: Store,
  target: AnimationRef
): VideoClipRef[] => {
  const state = store.getState();
  const output = state.doc.outputs[target.outputIndex];
  const clicked = { trackId: target.trackId, clipId: target.clipId };
  const inSelection = state.selectedClip?.outputIndex === target.outputIndex &&
    state.selectedClips.some((ref) =>
      ref.trackId === target.trackId && ref.clipId === target.clipId
    );
  const refs = inSelection ? state.selectedClips : [clicked];
  return output && 'tracks' in output ? expandClipRefs(output, refs) : refs;
};

export const copyAnimation = (
  store: Store,
  target: AnimationRef,
  orgId?: string
): AnimationCopyResult => store.getState().copyAnimation(
  target.outputIndex,
  target.trackId,
  target.clipId,
  orgId
);

export const pasteAnimation = (
  store: Store,
  target: AnimationRef,
  orgId?: string
): AnimationPasteResult => store.getState().pasteAnimation(
  target.outputIndex,
  animationTargetRefs(store, target),
  orgId
);

export const showAnimationCopyResult = (
  result: AnimationCopyResult,
  toaster: Toaster,
  t: Translate
) => {
  const skipped = skipSummary([{ reasons: result.skipped }], t);
  if (result.status === 'copied') {
    toaster.show(
      skipped
        ? t('designer_animation_copied_skipped', 'Animation copied. Not copied: {{reasons}}', { reasons: skipped })
        : t('designer_animation_copied', 'Animation copied'),
      skipped ? 'warning' : 'success'
    );
    return;
  }
  if (result.status === 'org-required') {
    toaster.show(t('designer_animation_org_required', 'Organization information is required to copy animation'), 'warning');
    return;
  }
  toaster.show(
    skipped
      ? t('designer_animation_copy_empty_skipped', 'No supported animation to copy. Skipped: {{reasons}}', { reasons: skipped })
      : t('designer_animation_copy_empty', 'No supported animation to copy'),
    'warning'
  );
};

export const showAnimationPasteResult = (
  result: AnimationPasteResult,
  toaster: Toaster,
  t: Translate
) => {
  const skipped = skipSummary(result.skipped, t);
  if (result.status === 'pasted') {
    toaster.show(
      skipped
        ? t(
            'designer_animation_pasted_skipped',
            'Animation pasted to {{count}} clip(s). Skipped: {{reasons}}',
            { count: result.targetCount, reasons: skipped }
          )
        : t('designer_animation_pasted', 'Animation pasted to {{count}} clip(s)', { count: result.targetCount }),
      skipped ? 'warning' : 'success'
    );
    return;
  }
  const message = result.status === 'org-mismatch'
    ? t('designer_animation_org_mismatch', 'Animation can only be pasted within the organization where it was copied')
    : result.status === 'frozen'
      ? t('designer_animation_frozen', 'Unfreeze this format to paste animation')
      : result.status === 'empty'
        ? t('designer_animation_paste_empty', 'Copy an animation first')
        : t('designer_animation_no_targets', 'No compatible editable animation targets');
  toaster.show(
    skipped
      ? t('designer_animation_no_targets_skipped', '{{message}}. Skipped: {{reasons}}', { message, reasons: skipped })
      : message,
    'warning'
  );
};

'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

const SHORTCUTS: { keys: string; label: string; labelKey: string }[] = [
  { keys: '⌘/Ctrl + Z', label: 'Undo', labelKey: 'designer_action_undo_undo' },
  { keys: '⌘/Ctrl + Shift + Z', label: 'Redo', labelKey: 'designer_action_redo_redo' },
  { keys: '⌘/Ctrl + C', label: 'Copy', labelKey: 'copy' },
  { keys: '⌘/Ctrl + X', label: 'Cut', labelKey: 'designer_action_cut_cut' },
  { keys: '⌘/Ctrl + V', label: 'Paste', labelKey: 'designer_action_paste_paste' },
  { keys: '⌘/Ctrl + D', label: 'Deselect', labelKey: 'designer_action_deselect_deselect' },
  { keys: '⌘/Ctrl + J', label: 'Duplicate', labelKey: 'designer_action_duplicate_duplicate' },
  { keys: '⌘/Ctrl + A', label: 'Select all', labelKey: 'designer_select_all_lower' },
  { keys: '⌘/Ctrl + G', label: 'Group', labelKey: 'group' },
  { keys: '⌘/Ctrl + Shift + G', label: 'Ungroup', labelKey: 'designer_action_ungroup_ungroup' },
  { keys: 'Delete / Backspace', label: 'Delete selection', labelKey: 'designer_delete_selection' },
  { keys: 'Arrows', label: 'Nudge 1px', labelKey: 'designer_nudge_1px' },
  { keys: 'Shift + Arrows', label: 'Nudge 10px', labelKey: 'designer_nudge_10px' },
  { keys: 'Enter', label: 'Edit text', labelKey: 'designer_edit_text' },
  { keys: 'Esc', label: 'Deselect', labelKey: 'designer_action_deselect_deselect' },
  { keys: 'Space + drag', label: 'Pan canvas', labelKey: 'designer_pan_canvas' },
  { keys: 'Scroll', label: 'Zoom', labelKey: 'designer_zoom' },
  { keys: 'Shift / ⌘ + click', label: 'Add to selection', labelKey: 'designer_add_to_selection' },
  { keys: 'Alt + click', label: 'Clone Stamp: set source', labelKey: 'designer_clone_stamp_set_source' },
  { keys: '⌘/Ctrl + K', label: 'Command palette', labelKey: 'designer_command_palette_lower' },
];

/** Timeline shortcuts — only meaningful while a video document is open. */
const VIDEO_SHORTCUTS: { keys: string; label: string; labelKey: string }[] = [
  { keys: 'Space', label: 'Play / pause', labelKey: 'designer_video_play_pause' },
  { keys: 'S', label: 'Split clip at playhead', labelKey: 'designer_video_split_clip' },
  { keys: '⌘/Ctrl + F', label: 'Freeze frame at playhead', labelKey: 'designer_video_freeze_frame' },
  { keys: 'Delete / Backspace', label: 'Remove selected clip', labelKey: 'designer_video_remove_clip' },
  { keys: '← / →', label: 'Ruler: ±0.1s (Shift: ±1s)', labelKey: 'designer_video_ruler_step' },
  { keys: ', / .', label: 'Step one frame back / forward', labelKey: 'designer_video_frame_step' },
  { keys: 'Drag on ruler', label: 'Scrub the playhead', labelKey: 'designer_video_scrub' },
];

export const ShortcutsOverlay: FC<{ onClose: () => void; videoMode?: boolean }> = ({ onClose, videoMode }) => {
  const t = useT();
  return (
    <div className="p-5 w-[420px] max-w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold text-textColor">{t('designer_keyboard_shortcuts_title', 'Keyboard shortcuts')}</h3>
        <button onClick={onClose} className="text-textColor/50 hover:text-textColor text-[16px]" aria-label={t('close', 'Close')}>
          ×
        </button>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between text-[12px]">
            <span className="text-textColor/70">{t(s.labelKey, s.label)}</span>
            <kbd className="px-2 py-0.5 rounded-sm bg-studioBorder/40 border border-studioBorder text-textColor/80 text-[11px]">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
      {videoMode && (
        <>
          <h4 className="text-[12px] font-semibold text-textColor/60 uppercase tracking-wider mt-4 mb-2">
            {t('designer_video_timeline_section', 'Video timeline')}
          </h4>
          <div className="grid grid-cols-1 gap-1.5">
            {VIDEO_SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between text-[12px]">
                <span className="text-textColor/70">{t(s.labelKey, s.label)}</span>
                <kbd className="px-2 py-0.5 rounded-sm bg-studioBorder/40 border border-studioBorder text-textColor/80 text-[11px]">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

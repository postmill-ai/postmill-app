'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const SHORTCUTS: { keys: string; label: string; labelKey: string }[] = [
  { keys: '⌘/Ctrl + Z', label: 'Undo', labelKey: 'designer_action_undo_undo' },
  { keys: '⌘/Ctrl + Shift + Z', label: 'Redo', labelKey: 'designer_action_redo_redo' },
  { keys: '⌘/Ctrl + C', label: 'Copy', labelKey: 'copy' },
  { keys: '⌘/Ctrl + X', label: 'Cut', labelKey: 'designer_action_cut_cut' },
  { keys: '⌘/Ctrl + V', label: 'Paste', labelKey: 'designer_action_paste_paste' },
  { keys: '⌘/Ctrl + D', label: 'Duplicate', labelKey: 'designer_action_duplicate_duplicate' },
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
  { keys: '⌘/Ctrl + K', label: 'Command palette', labelKey: 'designer_command_palette_lower' },
];

export const ShortcutsOverlay: FC<{ onClose: () => void }> = ({ onClose }) => {
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
            <kbd className="px-2 py-0.5 rounded bg-studioBorder/40 border border-studioBorder text-textColor/80 text-[11px]">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
};

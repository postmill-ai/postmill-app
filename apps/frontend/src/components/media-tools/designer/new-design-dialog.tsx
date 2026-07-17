'use client';

import React, { FC, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type StoreApi = ReturnType<typeof import('./designer.store').createDesignerStore>;

interface NewDesignDialogProps {
  store: StoreApi;
  onClose: () => void;
  /** Returns false to abort (e.g. user declined to discard unsaved changes). */
  guard: () => boolean;
}

const CHIPS = [
  { label: 'Square', w: 1080, h: 1080 },
  { label: 'Portrait', w: 1080, h: 1350 },
  { label: 'Story', w: 1080, h: 1920 },
  { label: 'Landscape', w: 1920, h: 1080 },
];

// CHIPS is a module-scope literal (no hook access) — map labels to keys at the render site.
const CHIP_LABEL_KEYS: Record<string, string> = {
  Square: 'designer_chip_square',
  Portrait: 'designer_chip_portrait',
  Story: 'designer_chip_story',
  Landscape: 'designer_chip_landscape',
};

// File → New → Custom Size… — pick mode + dimensions, then start a fresh doc.
export const NewDesignDialog: FC<NewDesignDialogProps> = ({ store, onClose, guard }) => {
  const t = useT();
  const [mode, setMode] = useState<'image' | 'video'>('image');
  const [w, setW] = useState('1080');
  const [h, setH] = useState('1080');

  const create = () => {
    const width = parseInt(w, 10);
    const height = parseInt(h, 10);
    if (!(width > 0 && height > 0)) return;
    if (!guard()) return;
    const st = store.getState();
    st.reset(width, height);
    // Label the single output as a custom format before any mode conversion
    // (setMode copies the source output's formatId/name).
    st.resizeOutput(0, width, height, mode === 'video' ? 'custom-video' : 'custom', `${width}×${height}`);
    if (mode === 'video') st.setMode('video');
    st.setCurrentOutput(0);
    onClose();
  };

  return (
    <div className="w-[360px] p-5 bg-newBgColorInner">
      <h2 className="text-[16px] font-bold text-textColor mb-4">{t('designer_new_design_title', 'New design')}</h2>

      <div className="flex gap-2 mb-4">
        {(['image', 'video'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-lg text-[13px] font-medium capitalize transition-colors ${
              mode === m
                ? 'bg-designerAccent text-white'
                : 'border border-studioBorder text-textColor hover:border-designerAccent hover:bg-boxHover'
            }`}
          >
            {m === 'image' ? t('designer_mode_image', 'image') : t('designer_mode_video', 'video')}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            onClick={() => {
              setW(String(c.w));
              setH(String(c.h));
            }}
            className="px-3 py-1.5 rounded-full text-[12px] border border-studioBorder text-textColor/80 hover:border-designerAccent hover:text-textColor transition-colors"
          >
            {t(CHIP_LABEL_KEYS[c.label], c.label)} <span className="text-textColor/40">{c.w}×{c.h}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-5">
        <input
          type="number"
          value={w}
          onChange={(e) => setW(e.target.value)}
          placeholder={t('designer_width_short', 'W')}
          className="w-full h-[38px] rounded-lg border border-studioBorder bg-newBgColor px-3 text-[13px] text-textColor text-center outline-none focus:border-designerAccent"
        />
        <span className="text-textColor/40">×</span>
        <input
          type="number"
          value={h}
          onChange={(e) => setH(e.target.value)}
          placeholder={t('designer_height_short', 'H')}
          className="w-full h-[38px] rounded-lg border border-studioBorder bg-newBgColor px-3 text-[13px] text-textColor text-center outline-none focus:border-designerAccent"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-[13px] border border-studioBorder text-textColor hover:bg-boxHover transition-colors"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          onClick={create}
          className="px-4 py-2 rounded-lg text-[13px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80 transition-colors"
        >
          {t('designer_create', 'Create')}
        </button>
      </div>
    </div>
  );
};

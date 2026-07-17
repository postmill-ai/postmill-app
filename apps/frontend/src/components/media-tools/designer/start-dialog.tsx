'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import { MyDesignsPanel } from './panels/my-designs-panel';
import { TemplatesPanel } from './panels/templates-panel';
import { fitWithin } from './panels/fit-within';
import SafeImage from '@gitroom/react/helpers/safe.image';

type StoreApi = ReturnType<typeof import('./designer.store').createDesignerStore>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface StartDialogProps {
  store: StoreApi;
  fetchFn: FetchLike;
  /** Called once a design has been created or opened — closes the dialog. */
  onDone: () => void;
}

type Step = 'home' | 'formats' | 'custom';

// Required startup modal over the editor (no dismiss): the user must Open an
// existing design/template, or create a New one and pick ≥1 format. This
// replaces the silent "blank → Instagram Post" default.
export const StartDialog: FC<StartDialogProps> = ({ store, fetchFn, onDone }) => {
  const translate = useT();
  const [step, setStep] = useState<Step>('home');
  const [mode, setMode] = useState<'image' | 'video'>('image');
  const [tab, setTab] = useState<'my-designs' | 'templates'>('my-designs');
  const [selected, setSelected] = useState<string[]>([]);
  const [cw, setCw] = useState('1080');
  const [ch, setCh] = useState('1080');

  const presets = useMemo(() => {
    // `ig-reel`/`tiktok` are tagged category:'story' but are video surfaces (they
    // have dedicated category:'video' twins `reel`/`tiktok-video`), so keep them
    // out of the photo list.
    const isVideoSurface = (p: (typeof CHANNEL_PRESETS)[number]) =>
      p.category === 'video' || p.id === 'ig-reel' || p.id === 'tiktok';
    return CHANNEL_PRESETS.filter((p) =>
      mode === 'video'
        ? p.category === 'video'
        : !isVideoSurface(p) && p.category !== 'custom'
    );
  }, [mode]);

  const startNew = (m: 'image' | 'video') => {
    setMode(m);
    setSelected([]);
    setStep('formats');
  };

  const toggle = useCallback(
    (id: string) => {
      // Image supports multiple output tabs; video is single-output.
      if (mode === 'video') {
        setSelected((cur) => (cur[0] === id ? [] : [id]));
      } else {
        setSelected((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]));
      }
    },
    [mode]
  );

  const createFromFormats = useCallback(() => {
    const found = selected
      .map((id) => presets.find((p) => p.id === id))
      .filter(Boolean) as typeof presets;
    if (!found.length) return;
    const first = found[0];
    const s = store.getState();
    s.reset(first.width, first.height);
    s.resizeOutput(0, first.width, first.height, first.id, first.name);
    if (mode === 'video') {
      s.setMode('video');
    } else {
      found.slice(1).forEach((p) =>
        s.addOutput({ formatId: p.id, name: p.name, width: p.width, height: p.height })
      );
    }
    s.setCurrentOutput(0);
    onDone();
  }, [selected, presets, mode, store, onDone]);

  const createCustom = useCallback(() => {
    const w = parseInt(cw, 10);
    const h = parseInt(ch, 10);
    if (!(w > 0 && h > 0)) return;
    const s = store.getState();
    s.reset(w, h);
    s.resizeOutput(0, w, h, mode === 'video' ? 'custom-video' : 'custom', `${w}×${h}`);
    if (mode === 'video') s.setMode('video');
    s.setCurrentOutput(0);
    onDone();
  }, [cw, ch, mode, store, onDone]);

  const openDesign = useCallback(
    async (d: { id: string }) => {
      const res = await fetchFn(`/media/designs/${d.id}`);
      if (!res.ok) return;
      const full = await res.json();
      store.getState().loadDesign(full.doc, full.id, full.name, null);
      onDone();
    },
    [fetchFn, store, onDone]
  );

  return (
    <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-studioBorder bg-newBgColorInner shadow-2xl">
        {step === 'home' && (
          <div className="p-6">
            <h2 className="text-[20px] font-bold text-textColor mb-1">{translate('designer_start_a_design_title', 'Start a design')}</h2>
            <p className="text-[13px] text-textColor/50 mb-5">
              {translate('designer_start_dialog_subtitle', 'Create a new design or open an existing one.')}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <button
                onClick={() => startNew('image')}
                className="flex flex-col items-start gap-1 p-4 rounded-xl border border-studioBorder hover:border-designerAccent hover:bg-designerAccent/5 transition-colors text-left"
              >
                <span className="text-[22px]">🖼️</span>
                <span className="text-[14px] font-semibold text-textColor">{translate('designer_new_photo', 'New Photo')}</span>
                <span className="text-[11px] text-textColor/50">{translate('designer_new_photo_description', 'Image design, one or more formats')}</span>
              </button>
              <button
                onClick={() => startNew('video')}
                className="flex flex-col items-start gap-1 p-4 rounded-xl border border-studioBorder hover:border-designerAccent hover:bg-designerAccent/5 transition-colors text-left"
              >
                <span className="text-[22px]">🎬</span>
                <span className="text-[14px] font-semibold text-textColor">{translate('designer_new_video', 'New Video')}</span>
                <span className="text-[11px] text-textColor/50">{translate('designer_new_video_description', 'Video design with a timeline')}</span>
              </button>
            </div>

            <div className="flex border-b border-studioBorder mb-3">
              {(['my-designs', 'templates'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-2 text-[13px] font-medium transition-colors ${
                    tab === t
                      ? 'text-btnPrimaryAccent border-b-2 border-designerAccent'
                      : 'text-textColor/50 hover:text-textColor/80'
                  }`}
                >
                  {t === 'my-designs' ? translate('designer_recent_designs', 'Recent Designs') : translate('designer_templates', 'Templates')}
                </button>
              ))}
            </div>
            <div>
              {tab === 'my-designs' ? (
                <MyDesignsPanel onOpen={openDesign} />
              ) : (
                <TemplatesPanel store={store} onClose={onDone} />
              )}
            </div>
          </div>
        )}

        {step === 'formats' && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[18px] font-bold text-textColor">
                {mode === 'video'
                  ? translate('designer_choose_a_video_format', 'Choose a video format')
                  : translate('designer_choose_formats', 'Choose formats')}
              </h2>
              <button
                onClick={() => setStep('home')}
                className="text-[13px] text-textColor/50 hover:text-textColor transition-colors"
              >
                {translate('designer_back_arrow', '← Back')}
              </button>
            </div>
            <p className="text-[12px] text-textColor/50 mb-4">
              {mode === 'video'
                ? translate('designer_pick_one_format_for_video', 'Pick one format for your video.')
                : translate('designer_pick_one_or_more_formats', 'Pick one or more — each becomes a linked output tab. (min 1)')}
            </p>

            <div className="overflow-y-auto max-h-[46vh] -mx-1 px-1 py-1">
              <div className="grid grid-cols-3 xs:grid-cols-2 gap-2.5">
                {presets.map((p) => {
                  const active = selected.includes(p.id);
                  // Generic (no provider) formats get an aspect-ratio shape cue.
                  const gf = fitWithin(p.width, p.height, 26, 26);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggle(p.id)}
                      aria-pressed={active}
                      title={`${p.name} · ${p.width} × ${p.height}`}
                      className={`group relative flex flex-col items-center gap-2 px-2 py-3 rounded-xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent ${
                        active
                          ? 'border-designerAccent ring-1 ring-designerAccent bg-designerAccent/10'
                          : 'border-studioBorder hover:border-designerAccent/60 hover:bg-studioBorder/5'
                      }`}
                    >
                      {active && (
                        <span className="absolute top-1.5 right-1.5 z-10 w-[16px] h-[16px] rounded-full bg-designerAccent text-white text-[10px] flex items-center justify-center shadow">
                          ✓
                        </span>
                      )}
                      <div className="w-[44px] h-[44px] rounded-xl bg-newBgColor border border-studioBorder flex items-center justify-center overflow-hidden">
                        {p.provider ? (
                          <SafeImage
                            src={`/icons/platforms/${p.provider}.png`}
                            alt={p.provider}
                            width={28}
                            height={28}
                            className="w-[28px] h-[28px] object-contain"
                          />
                        ) : (
                          <span
                            className="rounded-[2px] border-2 border-textColor/40"
                            style={{ width: Math.max(gf.width, 12), height: Math.max(gf.height, 12) }}
                          />
                        )}
                      </div>
                      <span className="text-[11.5px] font-medium text-textColor text-center leading-tight line-clamp-2">
                        {p.name}
                      </span>
                      <span className="text-[10px] text-textColor/45 tabular-nums leading-none">
                        {p.width} × {p.height}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-studioBorder">
              <button
                onClick={() => setStep('custom')}
                className="text-[13px] text-btnPrimaryAccent hover:underline"
              >
                {translate('designer_custom_size_ellipsis', 'Custom size…')}
              </button>
              <button
                onClick={createFromFormats}
                disabled={selected.length === 0}
                className="px-5 py-2.5 rounded-lg text-[14px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {translate('designer_create', 'Create')}{selected.length ? ` (${selected.length})` : ''}
              </button>
            </div>
          </div>
        )}

        {step === 'custom' && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[18px] font-bold text-textColor">{translate('designer_custom_size_title', 'Custom size')}</h2>
              <button
                onClick={() => setStep('formats')}
                className="text-[13px] text-textColor/50 hover:text-textColor transition-colors"
              >
                {translate('designer_back_arrow', '← Back')}
              </button>
            </div>
            <div className="flex items-center gap-2 mb-5">
              <input
                type="number"
                value={cw}
                onChange={(e) => setCw(e.target.value)}
                placeholder={translate('designer_width_short', 'W')}
                className="w-full h-[40px] rounded-lg border border-studioBorder bg-newBgColor px-3 text-[14px] text-textColor text-center outline-none focus:border-designerAccent"
              />
              <span className="text-textColor/40">×</span>
              <input
                type="number"
                value={ch}
                onChange={(e) => setCh(e.target.value)}
                placeholder={translate('designer_height_short', 'H')}
                className="w-full h-[40px] rounded-lg border border-studioBorder bg-newBgColor px-3 text-[14px] text-textColor text-center outline-none focus:border-designerAccent"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={createCustom}
                className="px-5 py-2.5 rounded-lg text-[14px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80 transition-colors"
              >
                {mode === 'video' ? translate('designer_create_video', 'Create video') : translate('designer_create_design', 'Create design')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

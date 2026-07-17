'use client';

import React, { useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { FullscreenButton } from '@gitroom/frontend/components/media-tools/fullscreen-button';
import { useFullscreen } from '@gitroom/frontend/components/media-tools/use-fullscreen';
import { Storyboard } from './storyboard';
import { TalkingPhoto } from './talking-photo';
import { Voiceover } from './voiceover';
import { Translate } from './translate';
import { RenderQueue } from './render-queue';
import { StudioLanding } from '@gitroom/frontend/components/media-tools/studio-kit/studio-landing';
import { useHeygenStatus, useHeygenAvatars, useHeygenVoices, useHeygenJobs } from './use-heygen';

const HEYGEN_LANDING = {
  website: 'https://www.heygen.com',
  tagline: 'Studio-quality AI avatar video from text',
  description:
    'HeyGen turns scripts, slides, or PDFs into professional videos with hyper-realistic AI avatars and natural voiceovers — no camera or crew. Best known for digital twins and video translation.',
  badges: ['Avatar', 'Video', 'Voice'],
  highlights: [
    'Photo avatars & digital twins with realistic lip-sync',
    'Video translation across 175+ languages',
    'Storyboard multi-scene avatar videos',
    'Talking Photo: animate a single portrait',
    'AI voiceover with controllable tone & delivery',
  ],
};

type TabKey = 'storyboard' | 'talking-photo' | 'translate' | 'voiceover';

export function HeyGenStudio() {
  const t = useT();
  const TABS: { key: TabKey; label: string }[] = [
    { key: 'storyboard', label: t('heygen_tab_storyboard', 'Storyboard') },
    { key: 'talking-photo', label: t('heygen_tab_talking_photo', 'Talking Photo') },
    { key: 'translate', label: t('heygen_tab_translate', 'Translate') },
    { key: 'voiceover', label: t('heygen_tab_voiceover', 'Voiceover') },
  ];
  const { data: status } = useHeygenStatus();
  const configured = status?.configured ?? false;

  const [tab, setTab] = useState<TabKey>('storyboard');

  const { data: avatarsData } = useHeygenAvatars(configured);
  const { data: voicesData } = useHeygenVoices(configured);
  const { data: jobs, isLoading: jobsLoading, mutate: mutateJobs } = useHeygenJobs(configured);
  // Full-screen fills the canvas app (not the page): the document goes fullscreen
  // (hides browser chrome, keeps modals which mount at the app root) and the studio
  // root goes immersive to cover the app nav/sidebar. z-[100] sits below modals (200+).
  const { isFullscreen } = useFullscreen();

  if (!status) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2B5CD3]" />
      </div>
    );
  }

  if (!configured) {
    return <StudioLanding identifier="heygen" title="HeyGen" landing={HEYGEN_LANDING} />;
  }

  return (
    <div className={`flex flex-col h-full bg-studioBg${isFullscreen ? ' fixed inset-0 z-[100]' : ' rounded-[12px] overflow-hidden'}`}>
      <div className="flex items-center justify-between gap-[10px] px-[16px] h-[52px] border-b border-studioBorder shrink-0">
        <div className="flex items-center gap-[10px] shrink-0">
          <Logo size={22} className="" />
          <h1 className="text-[15px] font-[600] text-textColor whitespace-nowrap">{t('heygen_studio_title', 'HeyGen Studio')}</h1>
        </div>
        <div className="flex items-center gap-[8px] min-w-0">
          <div className="flex items-center gap-[4px] overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-[12px] h-[34px] rounded-[8px] text-[13px] whitespace-nowrap border transition-all ${
                  tab === t.key
                    ? 'bg-[#2B5CD3]/20 text-textColor border-transparent'
                    : 'border-studioBorder text-newTextColor/70 hover:bg-boxHover hover:text-textColor hover:border-[#2B5CD3]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <FullscreenButton />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 mobile:flex-col">
        {/* Active tool */}
        <div className="flex-1 min-w-0 overflow-y-auto p-[20px]">
          {tab === 'storyboard' && (
            <Storyboard
              avatars={avatarsData?.avatars || []}
              voices={voicesData?.voices || []}
              onGenerated={() => mutateJobs()}
            />
          )}
          {tab === 'talking-photo' && (
            <TalkingPhoto voices={voicesData?.voices || []} onGenerated={() => mutateJobs()} />
          )}
          {tab === 'translate' && <Translate onGenerated={() => mutateJobs()} />}
          {tab === 'voiceover' && (
            <Voiceover voices={voicesData?.voices || []} onGenerated={() => mutateJobs()} />
          )}
        </div>

        {/* Render queue */}
        <div className="w-[320px] mobile:w-full shrink-0 border-l mobile:border-l-0 mobile:border-t border-studioBorder flex flex-col min-h-0">
          <div className="flex items-center justify-between px-[14px] h-[44px] border-b border-studioBorder shrink-0">
            <span className="text-[12px] font-[600] uppercase tracking-wider text-newTableText">{t('studio_render_queue', 'Render queue')}</span>
            <button
              type="button"
              onClick={() => mutateJobs()}
              aria-label={t('studio_refresh_queue', 'Refresh queue')}
              className="w-[26px] h-[26px] flex items-center justify-center rounded-[6px] text-newTextColor/65 hover:text-textColor hover:bg-boxHover transition-all"
            >
              ⟳
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-[12px]">
            <RenderQueue jobs={jobs} isLoading={jobsLoading} />
          </div>
        </div>
      </div>
    </div>
  );
}

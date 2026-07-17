'use client';

import React from 'react';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  studioNs,
  studioBadgeKey,
  studioLandingTaglineKey,
  studioLandingDescKey,
  studioLandingHighlightKey,
} from './i18n-keys';
import type { StudioLanding as StudioLandingContent } from './types';

// A professional, marketing-style landing page shown when a media provider isn't configured.
// Most users have never heard of these providers, so this explains what the provider is, what
// it supports, and why to use it — with a link to the provider's site and a configure CTA.
// Reused by every Studio Kit studio (via StudioShell) and the bespoke HeyGen / Replicate studios.
export function StudioLanding({
  identifier,
  title,
  landing,
}: {
  identifier: string;
  title: string;
  landing: StudioLandingContent;
}) {
  const t = useT();
  const ns = studioNs(identifier, title);
  return (
    <div className="h-full overflow-y-auto bg-studioBg">
      <div className="max-w-[760px] mx-auto px-[24px] py-[40px] mobile:py-[28px] flex flex-col">
        {/* Hero */}
        <div className="flex flex-col items-center text-center gap-[16px]">
          <span className="inline-flex items-center justify-center w-[88px] h-[88px] rounded-[20px] bg-newBgColor border border-studioBorder shadow-sm">
            <ProviderIcon identifier={landing.icon || identifier} name={title} size={56} />
          </span>

          <div className="flex items-center gap-[8px]">
            <span className="inline-flex items-center gap-[6px] px-[10px] py-[4px] rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-400 text-[11px] font-[600] uppercase tracking-wider">
              <span className="w-[6px] h-[6px] rounded-full bg-amber-500" />
              {t('studio_not_configured', 'Not configured')}
            </span>
          </div>

          <h1 className="text-[28px] mobile:text-[23px] font-[700] text-textColor leading-tight">{title}</h1>
          <p className="text-[16px] font-[600] text-btnPrimaryAccent">
            {t(studioLandingTaglineKey(ns), landing.tagline)}
          </p>

          {landing.badges?.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-[6px]">
              {landing.badges.map((b) => (
                <span
                  key={b}
                  className="px-[10px] py-[4px] rounded-full bg-[#2B5CD3]/12 border border-studioBorder text-textColor text-[12px] font-[500]"
                >
                  {t(studioBadgeKey(b), b)}
                </span>
              ))}
            </div>
          )}

          <p className="text-[14px] leading-[1.6] text-newTextColor/70 max-w-[560px]">
            {t(studioLandingDescKey(ns), landing.description)}
          </p>
        </div>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-[10px] mt-[24px]">
          <a
            href={`/settings/content/ai-media?search=${encodeURIComponent(identifier)}`}
            className="inline-flex items-center gap-[8px] px-[20px] py-[11px] rounded-[10px] bg-[#2B5CD3] text-white text-[14px] font-[600] hover:bg-[#2B5CD3]/85 transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {t('studio_configure_provider', 'Configure {{title}}', { title })}
          </a>
          <a
            href={landing.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-[8px] px-[20px] py-[11px] rounded-[10px] bg-transparent border border-studioBorder text-textColor text-[14px] font-[600] hover:bg-boxHover transition-all"
          >
            {t('studio_visit_website', 'Visit website')}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
            </svg>
          </a>
        </div>

        {/* Highlights */}
        {landing.highlights?.length > 0 && (
          <div className="mt-[32px] rounded-[14px] border border-studioBorder bg-newBgColor/40 p-[20px]">
            <div className="text-[11px] font-[700] uppercase tracking-wider text-newTableText mb-[14px]">
              {t('studio_what_you_can_do', 'What you can do')}
            </div>
            <div className="grid grid-cols-2 mobile:grid-cols-1 gap-x-[20px] gap-y-[12px]">
              {landing.highlights.map((h, i) => (
                <div key={h} className="flex items-start gap-[10px]">
                  <span className="mt-[1px] inline-flex items-center justify-center w-[18px] h-[18px] shrink-0 rounded-full bg-[#2B5CD3]/15 text-btnPrimaryAccent">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <span className="text-[13px] leading-[1.45] text-newTextColor/80">
                    {t(studioLandingHighlightKey(ns, i), h)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-[20px] text-center text-[12px] text-newTextColor/60">
          {t(
            'studio_credentials_encrypted_note',
            'Credentials are encrypted at rest and never leave your workspace.'
          )}
        </p>
      </div>
    </div>
  );
}

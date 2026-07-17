'use client';

import React from 'react';
import i18next from '@gitroom/react/translation/i18next';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { ProviderCatalogEntry } from '@gitroom/frontend/components/settings/shared/use-provider-catalog';

/**
 * Minimal "what is this provider" modal, opened by clicking a provider name in
 * the settings/setup provider list. Shows the brand icon + name, a one-line
 * localized description ("what it is / what it does"), and a link to the
 * provider's website ("where to get more info"). Nothing to maintain beyond the
 * per-provider `metadata.ts` description + website.
 */
export function ProviderInfoModal({
  entry,
  href,
}: {
  entry?: ProviderCatalogEntry;
  /** Optional secondary link (e.g. the media studio route for this provider). */
  href?: string;
}) {
  const t = useT();
  // resolvedLanguage collapses a region-suffixed locale (e.g. `es-ES`) to the base
  // code the description map is keyed by (`es`); fall back to `language`, then `en`.
  const lang = i18next.resolvedLanguage || i18next.language;
  const description =
    (entry?.description && (entry.description[lang] || entry.description.en)) || '';
  const name = entry?.displayName || entry?.providerId || '';

  return (
    <div className="flex flex-col gap-[16px] min-w-[300px] max-w-[440px]">
      <div className="flex items-center gap-[12px]">
        {entry?.providerId && (
          <ProviderIcon identifier={entry.providerId} name={name} size={40} />
        )}
        <span className="text-[18px] font-[600] text-textColor">{name}</span>
      </div>

      <p className="text-[14px] leading-[1.6] text-newTableText">
        {description ||
          t('provider_no_description', 'No description available yet.')}
      </p>

      {(entry?.website || href) && (
        <div className="flex items-center gap-[16px] pt-[4px]">
          {entry?.website && (
            <a
              href={entry.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-btnPrimaryAccent hover:underline"
            >
              {t('visit_website', 'Visit website')} ↗
            </a>
          )}
          {href && (
            <a href={href} className="text-[13px] text-btnPrimaryAccent hover:underline">
              {t('open', 'Open')} ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

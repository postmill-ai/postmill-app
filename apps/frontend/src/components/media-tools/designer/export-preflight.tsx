'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerPreflightFinding, DesignerPreflightResult } from './design-preflight';

const FALLBACKS: Record<DesignerPreflightFinding['rule'], string> = {
  'low-contrast': 'Low contrast ({{ratio}}:1) on {{target}}',
  'safe-zone': 'Text overlaps {{zone}} on {{target}}',
  'missing-media': 'Media source is missing on {{target}}',
  'text-overflow': 'Text overflows its box on {{target}}',
};

const UNASSESSED_FALLBACKS: Record<string, string> = {
  designer_preflight_unassessed_contrast_image: 'Contrast needs visual review over an image on {{target}}',
  designer_preflight_unassessed_contrast_gradient: 'Contrast needs visual review over a gradient on {{target}}',
  designer_preflight_unassessed_contrast_rich_text: 'Contrast needs visual review for rich text on {{target}}',
  designer_preflight_unassessed_text_measurement: 'Text fit could not be measured on {{target}}',
  designer_preflight_unassessed_geometry: 'Safe-zone geometry could not be assessed on {{target}}',
};

export const ExportPreflight: FC<{
  result: DesignerPreflightResult;
  onFinding: (finding: DesignerPreflightFinding) => void;
}> = ({ result, onFinding }) => {
  const t = useT();
  const unassessed = result.unassessed.contrast + result.unassessed.text + result.unassessed.geometry;
  if (!result.findings.length && !unassessed) return null;

  return (
    <div className="rounded-[6px] border border-yellow-500/30 bg-yellow-500/10 p-2" aria-label={t('designer_preflight', 'Preflight')}>
      <div className="text-[12px] text-yellow-400 font-medium mb-1">
        {t('designer_preflight', 'Preflight')}
      </div>
      {result.findings.length > 0 && (
        <div className="flex flex-col gap-1 max-h-[140px] overflow-y-auto">
          {result.findings.slice(0, 5).map((finding, index) => (
            <button
              type="button"
              key={`${finding.rule}-${finding.outputIndex}-${finding.pageNumber}-${finding.elementId || finding.clip?.clipId || index}`}
              onClick={() => onFinding(finding)}
              className="text-start text-[11px] text-newTextColor/70 hover:text-textColor hover:bg-yellow-500/10 rounded-sm px-1 py-0.5"
            >
              {t(finding.key, FALLBACKS[finding.rule], { ...finding.vars, interpolation: { escapeValue: false } })}
            </button>
          ))}
          {result.findings.length > 5 && (
            <div className="text-[10px] text-newTextColor/60 px-1">
              {t('designer_and_n_more', '…and {{count}} more', { count: result.findings.length - 5 })}
            </div>
          )}
        </div>
      )}
      {!!result.unassessedItems?.length && (
        <div className="mt-1 flex flex-col gap-1">
          {result.unassessedItems.slice(0, 5).map((item, index) => (
            <button
              type="button"
              key={`${item.key}-${item.outputIndex}-${item.pageNumber}-${item.elementId || item.clip?.clipId || index}`}
              onClick={() => onFinding(item)}
              className="text-start text-[10px] text-newTextColor/60 hover:text-textColor rounded-sm px-1 py-0.5 hover:bg-yellow-500/10"
            >
              {t(item.key, UNASSESSED_FALLBACKS[item.key] || 'This check needs visual review on {{target}}', { ...item.vars, interpolation: { escapeValue: false } })}
            </button>
          ))}
        </div>
      )}
      {unassessed > 0 && (
        <div className="text-[10px] text-newTextColor/60 mt-1">
          {t('designer_preflight_unassessed', '{{count}} check(s) could not be assessed', { count: unassessed })}
        </div>
      )}
    </div>
  );
};

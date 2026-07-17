'use client';

import { FC } from 'react';
import { PreflightResultItem } from './usePreflight';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface PreflightPanelProps {
  results: PreflightResultItem[];
  blocking: PreflightResultItem[];
  passed: boolean;
  onClose: () => void;
  onProceed: () => void;
}

export const PreflightPanel: FC<PreflightPanelProps> = ({
  results,
  blocking,
  passed,
  onClose,
  onProceed,
}) => {
  const t = useT();
  const hasWarnings = results.some((r) => r.warnings.length > 0);
  const hasBlocks = blocking.length > 0;

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center">
      <div className="bg-newBgColor rounded-[16px] border border-newTableBorder w-full max-w-[600px] max-h-[80vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="preflight-title">
        <div className="p-[20px] border-b border-newTableBorder">
          <h2 id="preflight-title" className="text-[18px] font-bold">{t('preflight_title', 'Content QA Preflight')}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-[20px] flex flex-col gap-[12px]">
          {hasBlocks && (
            <div className="bg-[#F97066]/10 border border-[#F97066] rounded-[8px] p-[12px]">
              <h3 className="text-[14px] font-semibold text-[#F97066] mb-[8px]">
                {t('preflight_blocking_issues', 'Blocking Issues')}
              </h3>
              {blocking.map((item) =>
                item.blocks.map((block, bi) => (
                  <div key={`block-${item.integrationId}-${bi}`} className="text-[13px] text-textColor mb-[4px]">
                    <strong>{item.name}:</strong> {block}
                  </div>
                ))
              )}
            </div>
          )}

          {hasWarnings && (
            <div className="bg-[#FFAC30]/10 border border-[#FFAC30] rounded-[8px] p-[12px]">
              <h3 className="text-[14px] font-semibold text-[#FFAC30] mb-[8px]">
                {t('preflight_warnings', 'Warnings')}
              </h3>
              {results
                .filter((r) => r.warnings.length > 0)
                .map((item) =>
                  item.warnings.map((warn, wi) => (
                    <div key={`warn-${item.integrationId}-${wi}`} className="text-[13px] text-textColor mb-[4px]">
                      <strong>{item.name}:</strong> {warn}
                    </div>
                  ))
                )}
            </div>
          )}

          {passed && (
            <div className="bg-[#32D583]/10 border border-[#32D583] rounded-[8px] p-[12px]">
              <h3 className="text-[14px] font-semibold text-[#32D583]">{t('preflight_all_checks_passed', 'All checks passed')}</h3>
              <p className="text-[13px] text-textColor mt-[4px]">
                {t('preflight_no_issues', 'Your content looks good! No issues found.')}
              </p>
            </div>
          )}

          <div className="mt-[8px]">
            <h3 className="text-[14px] font-semibold text-textColor mb-[8px]">
              {t('preflight_per_platform_details', 'Per-platform details')}
            </h3>
            {results.map((item) => (
              <div
                key={item.integrationId}
                className="flex items-center gap-[8px] py-[6px] text-[13px]"
              >
                <span
                  className={`w-[8px] h-[8px] rounded-full ${
                    item.valid ? 'bg-[#32D583]' : 'bg-[#F97066]'
                  }`}
                />
                <span className="text-textColor">{item.name}</span>
                {item.maximumCharacters && (
                  <span className="text-newTableText">
                    {t('preflight_max_chars', 'Max {{count}} chars', { count: item.maximumCharacters })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-[20px] border-t border-newTableBorder flex items-center justify-end gap-[12px]">
          <button
            onClick={onClose}
            className="px-[16px] py-[8px] text-[13px] font-medium text-newTableText hover:text-textColor transition-colors"
          >
            {t('cancel', 'Cancel')}
          </button>
          {!hasBlocks && (
            <button
              onClick={onProceed}
              className="px-[20px] py-[8px] bg-btnPrimary text-white text-[13px] font-medium rounded-[8px] transition-colors hover:opacity-80"
            >
              {t('proceed', 'Proceed')}
            </button>
          )}
          {hasBlocks && (
            <button
              onClick={onClose}
              className="px-[20px] py-[8px] bg-[#F97066] text-white text-[13px] font-medium rounded-[8px]"
            >
              {t('preflight_fix_issues', 'Fix issues')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

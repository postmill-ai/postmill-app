'use client';

import { FC, useRef, useState } from 'react';
import { useExport } from './hooks/useExport';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface ExportButtonProps {
  from: string;
  to: string;
  integrations?: string[];
  compare?: boolean;
  campaigns?: string[];
}

export const ExportButton: FC<ExportButtonProps> = ({
  from,
  to,
  integrations,
  compare,
  campaigns,
}) => {
  const t = useT();
  const toaster = useToaster();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { download } = useExport();

  const handleExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    setOpen(false);
    try {
      await download({ from, to, format, integrations, compare, campaigns });
    } catch {
      toaster.show(t('export_failed', 'Export failed. Please try again.'), 'warning');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={exporting}
        className="px-[12px] py-[6px] text-[13px] font-medium rounded-[8px] bg-newTableHeader border border-newTableBorder text-newTableText hover:text-btnText hover:border-newTableText transition-colors flex items-center gap-[6px]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
        >
          <path
            d="M7 1V9M7 9L4 6M7 9L10 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M1 10V12.5C1 12.776 1.224 13 1.5 13H12.5C12.776 13 13 12.776 13 12.5V10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        {exporting ? 'Exporting...' : 'Export'}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-[4px] z-50 bg-newBgColorInner border border-newTableBorder rounded-[8px] shadow-lg overflow-hidden min-w-[140px]">
            <button
              onClick={() => handleExport('csv')}
              className="w-full px-[14px] py-[8px] text-[13px] text-left hover:bg-boxHover transition-colors flex items-center gap-[8px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
              >
                <rect
                  x="1"
                  y="1"
                  width="12"
                  height="12"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M4 5H10M4 7H10M4 9H7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              CSV
            </button>
            <button
              onClick={() => handleExport('json')}
              className="w-full px-[14px] py-[8px] text-[13px] text-left hover:bg-boxHover transition-colors flex items-center gap-[8px]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
              >
                <path
                  d="M4 2L1 7L4 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M10 2L13 7L10 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M8 1L6 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
};

'use client';

import React from 'react';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const typeLabels: Record<string, string> = {
  LOCAL: 'Local Storage',
  S3: 'AWS S3',
  CLOUDFLARE_R2: 'Cloudflare R2',
  BACKBLAZE_B2: 'Backblaze B2',
  IDRIVE_E2: 'IDrive e2',
};

interface ProviderCardProps {
  provider: {
    id: string;
    type: string;
    name: string;
    mounted: boolean;
    quotaBytes?: string | null;
    bucket?: string | null;
    region?: string | null;
  };
  usageBytes?: string | null;
  hasOtherProviders?: boolean;
  onMount: (id: string) => void;
  onUnmount: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onMigrate?: (id: string) => void;
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  usageBytes,
  hasOtherProviders,
  onMount,
  onUnmount,
  onEdit,
  onDelete,
  onTest,
  onMigrate,
}) => {
  const t = useT();
  const quota = provider.quotaBytes ? BigInt(provider.quotaBytes) : null;
  const usage = usageBytes ? BigInt(usageBytes) : null;
  const usagePercent =
    quota && usage !== null && quota > 0
      ? Number((usage * BigInt(100)) / quota)
      : null;

  return (
    <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex flex-col gap-[12px]">
      <div className="flex items-center gap-[12px]">
        <ProviderIcon
          identifier={provider.type}
          name={provider.name}
          size={36}
        />
        <div className="flex-1 min-w-0">
          <h4 className="text-[14px] font-medium text-textColor truncate">
            {provider.name}
          </h4>
          <p className="text-[12px] text-newTableText">
            {t('storage_type_' + provider.type, typeLabels[provider.type] || provider.type)}
            {provider.bucket ? ` · ${provider.bucket}` : ''}
            {provider.region ? ` · ${provider.region}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-[6px]">
          {provider.type === 'LOCAL' ? (
            <div className="px-[8px] py-[2px] rounded-full text-[11px] font-medium bg-[#1a3a1a] text-textColor">
              {t('always_on', 'Always on')}
            </div>
          ) : (
            <div
              className={`px-[8px] py-[2px] rounded-full text-[11px] font-medium ${
                provider.mounted
                  ? 'bg-[#1a3a1a] text-textColor'
                  : 'bg-[#3a1a1a] text-[#f87171]'
              }`}
            >
              {provider.mounted ? t('mounted', 'Mounted') : t('unmounted', 'Unmounted')}
            </div>
          )}
        </div>
      </div>

      {usagePercent !== null && (
        <div className="flex flex-col gap-[4px]">
          <div className="flex justify-between text-[11px] text-newTableText">
            <span>{t('usage', 'Usage')}</span>
            <span>{usagePercent}%</span>
          </div>
          <div className="h-[4px] bg-newTableHeader rounded-full overflow-hidden">
            <div
              className="h-full bg-btnPrimary rounded-full transition-all"
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex gap-[8px] flex-wrap">
        {provider.type !== 'LOCAL' && (
          <>
            {provider.mounted ? (
              <button
                onClick={() => onUnmount(provider.id)}
                className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-[#f87171] hover:bg-[#3a2a2a] transition-colors"
              >
                {t('unmount', 'Unmount')}
              </button>
            ) : (
              <button
                onClick={() => onMount(provider.id)}
                className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-textColor hover:bg-[#1a3a1a] transition-colors"
              >
                {t('mount', 'Mount')}
              </button>
            )}
          </>
        )}
        <button
          onClick={() => onEdit(provider.id)}
          className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-newTableText hover:bg-[#3a3a3a] transition-colors"
        >
          {t('edit', 'Edit')}
        </button>
        <button
          onClick={() => onTest(provider.id)}
          className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-blue-700 dark:text-blue-400 hover:bg-[#1a2a3a] transition-colors"
        >
          {t('test', 'Test')}
        </button>
        {provider.type !== 'LOCAL' && hasOtherProviders && (
          <button
            onClick={() => onMigrate?.(provider.id)}
            className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-[#f59e0b] hover:bg-[#3a2a1a] transition-colors"
          >
            {t('migrate', 'Migrate')}
          </button>
        )}
        {provider.type !== 'LOCAL' && (
          <button
            onClick={() => onDelete(provider.id)}
            className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-[#f87171] hover:bg-[#3a1a1a] transition-colors ml-auto"
          >
            {t('delete', 'Delete')}
          </button>
        )}
      </div>
    </div>
  );
};

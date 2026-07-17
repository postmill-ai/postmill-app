'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';

interface ProviderData {
  identifier: string;
  name: string;
  capabilities: string[];
  isConfigured: boolean;
  enabled: boolean;
}

const OPERATION_LABELS: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  tts: 'TTS',
  stt: 'STT',
  upscale: 'Upscale',
  'bg-remove': 'Bg Remove',
  inpaint: 'Inpaint',
  embedding: 'Embedding',
};

const OPERATION_COLORS: Record<string, string> = {
  image: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  video: 'bg-red-500/20 text-dangerText',
  tts: 'bg-green-500/20 text-green-800 dark:text-green-400',
  stt: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400',
  upscale: 'bg-orange-500/20 text-orange-800 dark:text-orange-400',
  'bg-remove': 'bg-pink-500/20 text-pink-800 dark:text-pink-400',
  inpaint: 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-400',
  embedding: 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-400',
};

interface ProviderCardProps {
  provider: ProviderData;
  onConfigure: (identifier: string) => void;
  onToggle: (identifier: string, enabled: boolean) => void;
}

export const ProviderCard = ({ provider, onConfigure, onToggle }: ProviderCardProps) => {
  const t = useT();

  return (
    <div className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[16px] flex flex-col gap-[12px]">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-[10px]">
          <ProviderIcon identifier={provider.identifier} name={provider.name} size={36} />
          <span className="text-[15px] font-semibold">{provider.name}</span>
        </div>
        <span
          className={`text-[11px] rounded-[4px] px-[8px] py-[3px] font-medium ${
            provider.enabled && provider.isConfigured
              ? 'bg-green-500/20 text-green-800 dark:text-green-400'
              : provider.isConfigured
                ? 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-400'
                : 'bg-newTableHeader text-newTableText'
          }`}
        >
          {provider.enabled && provider.isConfigured
            ? t('active', 'Active')
            : provider.isConfigured
              ? t('disabled', 'Disabled')
              : t('not_configured', 'Not Configured')}
        </span>
      </div>

      <div className="flex flex-wrap gap-[4px]">
        {provider.capabilities.map((op) => (
          <span
            key={op}
            className={`text-[11px] rounded-[4px] px-[6px] py-[2px] ${
              OPERATION_COLORS[op] || 'bg-newTableHeader text-newTableText'
            }`}
          >
            {OPERATION_LABELS[op] || op}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between pt-[8px] border-t border-newTableBorder">
        <button
          className="text-[13px] text-textColor hover:underline"
          onClick={() => onConfigure(provider.identifier)}
        >
          {provider.isConfigured ? t('edit_config', 'Edit Config') : t('configure', 'Configure')}
        </button>

        {provider.isConfigured && (
          <label className="flex items-center gap-[6px] cursor-pointer">
            <span className="text-[12px] text-newTableText">
              {t('enabled', 'Enabled')}
            </span>
            <input
              type="checkbox"
              className="accent-btnPrimary"
              checked={provider.enabled}
              onChange={(e) => onToggle(provider.identifier, e.target.checked)}
            />
          </label>
        )}
      </div>
    </div>
  );
};

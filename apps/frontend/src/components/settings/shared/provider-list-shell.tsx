'use client';

import React, { ReactNode } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export interface ProviderConfigItem {
  id: string;
  identifier: string;
  name: string;
  enabled: boolean;
  isActive?: boolean;
  isConfigured?: boolean;
  mounted?: boolean;
  status?: string[];
  capabilities?: string[];
  /** Pinned provider-framework version, e.g. "v1". */
  version?: string;
  /** Version lifecycle status from the public catalog. */
  versionStatus?: 'preview' | 'active' | 'deprecated' | 'retired';
  /** Sunset date for the pinned (deprecated) version, ISO string. */
  sunsetAt?: string;
  /**
   * Live-key verification from the catalog. When explicitly `false`, the provider
   * was built without a live key and renders a "Beta" badge (plan E24).
   */
  verified?: boolean;
  /** Platform-curated "featured" provider — renders a gold-star badge on the name line. */
  featured?: boolean;
  /** Render a thin divider above this row (tier boundary, e.g. above/below the featured group). */
  separatorBefore?: boolean;
  /**
   * Passthrough of the full original provider object so `renderBadges`/
   * `renderActions` receive it directly via `provider.meta` — kills the
   * `filteredProviders.find(...)` re-find anti-pattern (plan §1.1/§0.3.4).
   */
  meta?: unknown;
}

export interface ProviderListShellProps {
  providers: ProviderConfigItem[];
  onConfigure: (identifier: string) => void;
  /**
   * Reopen the configure modal preset to the latest active version (plan §9.3).
   * Falls back to `onConfigure` when not provided.
   */
  onUpgrade?: (identifier: string) => void;
  onSetActive?: (identifier: string) => void;
  onRemove: (identifier: string) => void;
  onToggle?: (identifier: string, enabled: boolean) => void;
  title: string;
  description?: string;
  ProviderIconComponent: React.FC<{ identifier: string; name: string; size?: number }>;
  getProviderHref?: (provider: ProviderConfigItem) => string | undefined;
  /** When set, the provider name becomes a button that opens an info modal. */
  onProviderNameClick?: (provider: ProviderConfigItem) => void;
  renderBadges?: (provider: ProviderConfigItem) => ReactNode;
  renderActions?: (provider: ProviderConfigItem) => ReactNode;
  addProviderButton?: ReactNode;
  toolbar?: ReactNode;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-900/20 text-green-900 dark:text-green-400',
  configured: 'bg-blue-900/20 text-blue-800 dark:text-blue-400',
  enabled: 'bg-green-900/20 text-green-900 dark:text-green-400',
  mounted: 'bg-[#1a3a1a] text-textColor',
  disabled: 'bg-[#3a1a1a] text-[#f87171]',
};

const VERSION_STYLES: Record<string, string> = {
  preview: 'bg-purple-900/20 text-purple-800 dark:text-purple-400',
  active: 'bg-green-900/20 text-green-900 dark:text-green-400',
  deprecated: 'bg-amber-900/20 text-amber-800 dark:text-amber-400',
  retired: 'bg-red-900/20 text-dangerText',
};

const VERSION_LABEL: Record<string, string> = {
  preview: 'Preview',
  active: 'Active',
  deprecated: 'Deprecated',
  retired: 'Retired',
};

const ProviderListShell: React.FC<ProviderListShellProps> = ({
  providers,
  onConfigure,
  onUpgrade,
  onSetActive,
  onRemove,
  onToggle,
  title,
  description,
  ProviderIconComponent,
  getProviderHref,
  onProviderNameClick,
  renderBadges,
  renderActions,
  addProviderButton,
  toolbar,
}) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[16px]">
      {(title || description || addProviderButton) && (
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-[4px]">
            {title && (
              <h3 className="text-[18px] font-semibold text-textColor">{title}</h3>
            )}
            {description && (
              <p className="text-[13px] text-newTableText">{description}</p>
            )}
          </div>
          {addProviderButton}
        </div>
      )}

      {toolbar}

      <div className="flex flex-col gap-[8px]">
        {providers.length === 0 ? (
          <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] text-center">
            <span className="text-[13px] text-newTableText">
              {t(
                'no_providers_configured',
                'No providers configured. Use the button above to add one.',
              )}
            </span>
          </div>
        ) : (
          providers.map((provider) => (
            <React.Fragment key={provider.id || provider.identifier}>
              {provider.separatorBefore && (
                <hr className="my-[8px] border-0 border-t border-newTableBorder" />
              )}
              <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[16px] flex items-center gap-[12px]">
                <ProviderIconComponent
                identifier={provider.identifier}
                name={provider.name}
                size={36}
              />

              <div className="flex flex-col gap-[4px] flex-1 min-w-0">
                <div className="flex items-center gap-[8px] flex-wrap">
                  {(() => {
                    const href = getProviderHref?.(provider);
                    if (onProviderNameClick) {
                      return (
                        <button
                          type="button"
                          onClick={() => onProviderNameClick(provider)}
                          className="text-[14px] font-semibold truncate hover:text-btnPrimaryAccent hover:underline transition-colors text-left"
                          title={t('what_is_this', 'What is this?')}
                        >
                          {provider.name}
                        </button>
                      );
                    }
                    return href ? (
                      <Link
                        href={href}
                        className="text-[14px] font-semibold truncate hover:text-btnPrimaryAccent hover:underline transition-colors"
                      >
                        {provider.name}
                      </Link>
                    ) : (
                      <span className="text-[14px] font-semibold truncate">
                        {provider.name}
                      </span>
                    );
                  })()}
                  {provider.featured && (
                    <span
                      className="text-[11px] rounded-[4px] px-[8px] py-[2px] font-medium bg-amber-500/15 text-amber-800 dark:text-amber-400 inline-flex items-center gap-[4px]"
                      title={t('featured_provider', 'Featured provider')}
                    >
                      <svg
                        viewBox="0 0 20 20"
                        width="10"
                        height="10"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M10 1.5l2.6 5.27 5.82.846-4.21 4.104.994 5.795L10 14.86l-5.204 2.735.994-5.795L1.58 7.616l5.82-.846L10 1.5z" />
                      </svg>
                      {t('featured', 'Featured')}
                    </span>
                  )}
                  {provider.verified === false && (
                    <span
                      className="text-[11px] rounded-[4px] px-[8px] py-[2px] font-medium bg-amber-900/20 text-amber-800 dark:text-amber-400"
                      title={t(
                        'beta_unverified_hint',
                        'Built without a live key — request shape unverified.',
                      )}
                    >
                      {t('beta', 'Beta')}
                    </span>
                  )}
                  {(provider.status || []).map((s) => (
                    <span
                      key={s}
                      className={`text-[11px] rounded-[4px] px-[8px] py-[2px] font-medium ${
                        STATUS_STYLES[s] || 'bg-newTableHeader text-newTableText'
                      }`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </span>
                  ))}
                  {provider.isActive && (
                    <span className="text-[11px] bg-green-900/20 text-green-900 dark:text-green-400 rounded-[4px] px-[8px] py-[2px]">
                      {t('active', 'Active')}
                    </span>
                  )}
                  {provider.mounted && (
                    <span className="text-[11px] bg-[#1a3a1a] text-textColor rounded-[4px] px-[8px] py-[2px]">
                      {t('mounted', 'Mounted')}
                    </span>
                  )}
                  {provider.version && (
                    <span
                      className={`text-[11px] rounded-[4px] px-[8px] py-[2px] ${
                        VERSION_STYLES[provider.versionStatus || 'active'] ||
                        'bg-newTableHeader text-newTableText'
                      }`}
                      title={t('pinned_to_version', 'Pinned to version {{version}}', {
                        version: provider.version,
                      })}
                    >
                      {provider.version}
                      {provider.versionStatus && provider.versionStatus !== 'active'
                        ? t('version_status_separator', '— {{status}}', {
                            status: t(
                              'version_status_' + provider.versionStatus,
                              VERSION_LABEL[provider.versionStatus],
                            ),
                          })
                        : ''}
                    </span>
                  )}
                </div>

                {provider.versionStatus === 'deprecated' && (
                  <div className="mt-[6px] flex items-center gap-[8px] flex-wrap rounded-[8px] border border-amber-500/40 bg-amber-500/10 px-[10px] py-[6px]">
                    <span className="text-[12px] text-amber-600">
                      {provider.sunsetAt
                        ? t(
                            'provider_deprecated_with_sunset',
                            'Version {{version}} is deprecated and will be retired on {{date}}. Upgrade to the latest active version to keep it working.',
                            {
                              version: provider.version,
                              date: new Date(provider.sunsetAt).toLocaleDateString(),
                            },
                          )
                        : t(
                            'provider_deprecated',
                            'Version {{version}} is deprecated. Upgrade to the latest active version to keep it working.',
                            { version: provider.version },
                          )}
                    </span>
                    <button
                      type="button"
                      className="text-[12px] font-medium rounded-[6px] px-[10px] py-[3px] bg-amber-500/20 text-amber-800 dark:text-amber-400 hover:bg-amber-500/30 transition-colors whitespace-nowrap"
                      onClick={() =>
                        (onUpgrade ?? onConfigure)(provider.identifier)
                      }
                    >
                      {t('upgrade', 'Upgrade')}
                    </button>
                  </div>
                )}
                {provider.versionStatus === 'retired' && (
                  <div className="mt-[6px] flex items-center gap-[8px] flex-wrap rounded-[8px] border border-red-500/40 bg-red-500/10 px-[10px] py-[6px]">
                    <span className="text-[12px] text-dangerText">
                      {t(
                        'provider_retired',
                        'Version {{version}} is retired and no longer functional. Reconfigure this provider to resume service.',
                        { version: provider.version },
                      )}
                    </span>
                    <button
                      type="button"
                      className="text-[12px] font-medium rounded-[6px] px-[10px] py-[3px] bg-red-500/20 text-dangerText hover:bg-red-500/30 transition-colors whitespace-nowrap"
                      onClick={() => onConfigure(provider.identifier)}
                    >
                      {t('reconfigure', 'Reconfigure')}
                    </button>
                  </div>
                )}

                {renderBadges ? (
                  renderBadges(provider)
                ) : (
                  (provider.capabilities && provider.capabilities.length > 0) && (
                    <div className="flex gap-[4px] mt-[4px] flex-wrap">
                      {provider.capabilities.map((cap) => (
                        <span
                          key={cap}
                          className="text-[10px] bg-newTableText/20 text-newTableText rounded-[2px] px-[4px] py-[1px]"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  )
                )}
              </div>

              <div className="flex items-center gap-[8px] shrink-0">
                {provider.versionStatus === 'retired' ? (
                  // Retired = non-functional: only allow reconfigure (banner) or remove.
                  provider.isConfigured && (
                    <button
                      className="text-[12px] text-red-600 dark:text-red-500 hover:underline"
                      onClick={() => onRemove(provider.identifier)}
                    >
                      {t('remove', 'Remove')}
                    </button>
                  )
                ) : renderActions ? (
                  renderActions(provider)
                ) : (
                  <>
                    <button
                      className="text-[12px] text-btnPrimaryAccent hover:underline"
                      onClick={() => onConfigure(provider.identifier)}
                    >
                      {provider.isConfigured ? t('edit', 'Edit') : t('configure', 'Configure')}
                    </button>
                    {provider.isConfigured && onSetActive && !provider.isActive && (
                      <button
                        className="text-[12px] text-btnPrimaryAccent hover:underline"
                        onClick={() => onSetActive(provider.identifier)}
                      >
                        {t('set_active', 'Set Active')}
                      </button>
                    )}
                    {onToggle && provider.isConfigured && (
                      <label className="flex items-center gap-[4px] cursor-pointer">
                        <span className="text-[11px] text-newTableText">
                          {provider.enabled ? t('on', 'On') : t('off', 'Off')}
                        </span>
                        <input
                          type="checkbox"
                          className="accent-btnPrimary w-[14px] h-[14px]"
                          checked={provider.enabled}
                          onChange={(e) => onToggle(provider.identifier, e.target.checked)}
                        />
                      </label>
                    )}
                    {provider.isConfigured && (
                      <button
                        className="text-[12px] text-red-600 dark:text-red-500 hover:underline"
                        onClick={() => onRemove(provider.identifier)}
                      >
                        {t('remove', 'Remove')}
                      </button>
                    )}
                  </>
                )}
              </div>
              </div>
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
};

export default ProviderListShell;

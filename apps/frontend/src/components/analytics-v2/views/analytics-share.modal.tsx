'use client';

import { FC, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useAnalyticsShare } from '../hooks/useAnalyticsShare';
import { ChannelAvatar } from '../kit/channel-avatar';
import { TabSkeleton } from '../kit/states';

const RANGE_PRESETS: { value: string; labelKey: string; fallback: string }[] = [
  { value: 'last_7d', labelKey: 'share_range_7d', fallback: 'Last 7 days' },
  { value: 'last_30d', labelKey: 'share_range_30d', fallback: 'Last 30 days' },
  { value: 'last_90d', labelKey: 'share_range_90d', fallback: 'Last 90 days' },
];

// Org-level public share dashboard modal (7.6). Mint/rotate/disable a public
// token + pick channels and a rolling range; copy the read-only public link.
export const AnalyticsShareModal: FC = () => {
  const t = useT();
  const toaster = useToaster();
  const { data, isLoading, error, save, disable } = useAnalyticsShare();
  const { data: integrationsData } = useIntegrationList();
  const integrations = useMemo(
    () => (integrationsData || []) as Integrations[],
    [integrationsData]
  );

  const [selected, setSelected] = useState<string[] | null>(null);
  const [rangePreset, setRangePreset] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fall back to the loaded config until the user edits.
  const selectedChannels = selected ?? data?.config?.integrations ?? [];
  const range = rangePreset ?? data?.config?.rangePreset ?? 'last_30d';

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl =
    data?.enabled && data?.token ? `${origin}/share/analytics/${data.token}` : '';

  const toggleChannel = (id: string) => {
    const base = selected ?? data?.config?.integrations ?? [];
    setSelected(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  };

  const mint = async (rotate: boolean) => {
    setBusy(true);
    try {
      await save({
        integrations: selectedChannels.length ? selectedChannels : undefined,
        rangePreset: range,
      });
      toaster.show(
        rotate
          ? t('share_link_rotated', 'Share link rotated')
          : t('share_link_created', 'Public share link created'),
        'success'
      );
    } catch {
      toaster.show(t('share_failed', 'Failed to update share link'), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disable();
      toaster.show(t('share_removed', 'Public share link removed'), 'success');
    } catch {
      toaster.show(t('share_delete_failed', 'Failed to remove share link'), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!publicUrl) return;
    // navigator.clipboard is undefined on non-HTTPS origins — fall back to a
    // "copy manually" hint instead of throwing.
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(publicUrl);
      toaster.show(t('link_copied_to_clipboard', 'Link copied to clipboard'), 'success');
    } catch {
      toaster.show(
        t('link_copy_manual', 'Could not copy automatically — select the link and copy it manually'),
        'warning'
      );
    }
  };

  if (isLoading) {
    return (
      <div className="w-full sm:w-[520px] max-w-full">
        <TabSkeleton variant="list" />
      </div>
    );
  }

  // The share config GET is permission-gated (analytics:update) — a 403 (or
  // any load failure) renders a quiet notice instead of a broken form.
  if (error) {
    return (
      <div className="w-full sm:w-[520px] max-w-full">
        <p className="text-[13px] text-newTableText">
          {t(
            'analytics_share_no_access',
            'Sharing is managed by org admins — you don’t have access to the public share settings.'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full sm:w-[520px] max-w-full flex flex-col gap-[16px]">
      <p className="text-[13px] text-newTableText">
        {t(
          'analytics_share_desc',
          'Create a read-only public link to a live analytics dashboard scoped to the channels and range you choose.'
        )}
      </p>

      {/* Range preset */}
      <label className="flex flex-col gap-[4px]">
        <span className="text-[12px] text-newTableText">{t('share_range', 'Date range')}</span>
        <select
          value={range}
          onChange={(e) => setRangePreset(e.target.value)}
          className="px-[10px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
        >
          {RANGE_PRESETS.map((r) => (
            <option key={r.value} value={r.value}>
              {t(r.labelKey, r.fallback)}
            </option>
          ))}
        </select>
      </label>

      {/* Channel picker (empty = all channels) */}
      <div className="flex flex-col gap-[6px]">
        <span className="text-[12px] text-newTableText">
          {t('share_channels', 'Channels (none selected = all)')}
        </span>
        <div className="max-h-[180px] overflow-y-auto flex flex-col gap-[4px] border border-newTableBorder rounded-[8px] p-[8px]">
          {integrations.map((i) => (
            <label
              key={i.id}
              className="flex items-center gap-[8px] px-[6px] py-[4px] rounded-[6px] hover:bg-newTableHeader cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedChannels.includes(i.id)}
                onChange={() => toggleChannel(i.id)}
                className="w-[15px] h-[15px] accent-btnPrimary"
              />
              <ChannelAvatar src={i.picture} name={i.name} identifier={i.identifier} size={22} />
              <span className="text-[13px] truncate">{i.name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Public URL + actions */}
      {publicUrl && (
        <div className="flex items-center gap-[8px] p-[10px] bg-newBgColorInner border border-newTableBorder rounded-[8px]">
          <span className="text-[12px] text-newTableText truncate flex-1">{publicUrl}</span>
          <button
            type="button"
            onClick={copy}
            className="px-[10px] py-[5px] text-[12px] font-medium bg-newTableHeader text-newTableText rounded-[6px] hover:text-textColor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
          >
            {t('copy', 'Copy')}
          </button>
        </div>
      )}

      <div className="flex items-center gap-[8px] flex-wrap">
        <button
          type="button"
          onClick={() => mint(data?.enabled ?? false)}
          disabled={busy}
          className="px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[13px] font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
        >
          {data?.enabled
            ? t('share_save_rotate', 'Save / rotate link')
            : t('share_create', 'Create link')}
        </button>
        {data?.enabled && (
          <button
            type="button"
            onClick={turnOff}
            disabled={busy}
            className="px-[16px] py-[8px] bg-newTableHeader text-amber-600 rounded-[8px] text-[13px] font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
          >
            {t('share_disable', 'Disable link')}
          </button>
        )}
      </div>
    </div>
  );
};

'use client';

import React, { FC, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Button } from '@postmill-ai/react/form/button';
import { Checkbox } from '@postmill-ai/react/form/checkbox';
import { Input } from '@postmill-ai/react/form/input';
import { Select } from '@postmill-ai/react/form/select';
import { useT, useTranslationSettings } from '@postmill-ai/react/translation/get.transation.service.client';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import {
  clientDesignShareUrl,
  designShareUrl,
  designViewUrl,
  formatDesignShareDate,
  useDesignShare,
} from './design-sharing';

export { designShareUrl } from './design-sharing';

export const ShareDialog: FC<{
  designId: string;
  initialCollabEnabled: boolean;
  connectedCount: number;
  onToggleCollaboration: (enabled: boolean) => void;
}> = ({ designId, initialCollabEnabled, connectedCount, onToggleCollaboration }) => {
  const t = useT();
  const i18next = useTranslationSettings();
  const fetch = useFetch();
  const [collabEnabled, setCollabEnabled] = useState(initialCollabEnabled);
  const [teamAccess, setTeamAccess] = useState<'edit' | 'view'>('edit');
  const [copied, setCopied] = useState<'team' | 'client' | null>(null);
  const [defaultExpiry] = useState(() => dayjs().add(7, 'day').format('YYYY-MM-DD'));
  const [expiryDate, setExpiryDate] = useState(defaultExpiry);
  const [commentsEnabled, setCommentsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const { data: share, error, isLoading, mutate } = useDesignShare(designId);

  useEffect(() => {
    if (share === undefined) return;
    setCommentsEnabled(share?.commentsEnabled ?? false);
    setExpiryDate(share ? dayjs(share.expiresAt).format('YYYY-MM-DD') : defaultExpiry);
  }, [share, defaultExpiry]);

  const teamUrl = teamAccess === 'edit'
    ? designShareUrl(designId, window.location.origin)
    : designViewUrl(designId, window.location.origin);
  const clientUrl = share ? clientDesignShareUrl(share.token, window.location.origin) : '';

  const copy = async (kind: 'team' | 'client', url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(kind);
  };

  const toggle = () => {
    const next = !collabEnabled;
    setCollabEnabled(next);
    onToggleCollaboration(next);
  };

  const saveClient = async (enabled: boolean) => {
    setActionError('');
    const expiry = dayjs(expiryDate).endOf('day');
    if (!expiry.isValid() || !expiry.isAfter(dayjs())) {
      setActionError(t('designer_share_expiry_future', 'Choose a future expiry date.'));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/media/designs/${designId}/share`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          commentsEnabled,
          expiresAt: expiry.toISOString(),
        }),
      });
      if (!response.ok) throw new Error('Save failed');
      await mutate(await response.json(), { revalidate: false });
    } catch {
      setActionError(t('designer_share_save_failed', 'Could not save sharing settings.'));
    } finally {
      setBusy(false);
    }
  };

  const disableClient = async () => {
    setBusy(true);
    setActionError('');
    try {
      const response = await fetch(`/media/designs/${designId}/share`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Disable failed');
      await mutate(await response.json(), { revalidate: false });
    } catch {
      setActionError(t('designer_share_save_failed', 'Could not save sharing settings.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-[13px] font-medium text-textColor">{t('designer_team_link', 'Team link')}</h3>
          <p className="text-[11px] text-newTextColor/60">
            {t('designer_team_link_hint', 'Only members of this organization can open a team link.')}
          </p>
        </div>
        <Select
          name="teamAccess"
          label={t('designer_team_permission', 'Team access')}
          aria-label={t('designer_team_permission', 'Team access')}
          disableForm
          hideErrors
          value={teamAccess}
          onChange={(event) => setTeamAccess(event.target.value as 'edit' | 'view')}
          className="h-[38px] text-[12px]"
        >
          <option value="edit">{t('designer_can_edit', 'Can edit')}</option>
          <option value="view">{t('designer_can_view', 'Can view')}</option>
        </Select>
        <p className="text-[11px] text-newTextColor/60">
          {t('designer_team_view_hint', 'Can view opens a read-only preview; it does not restrict teammates who can edit.')}
        </p>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              name="teamLink"
              label={t('designer_team_link', 'Team link')}
              aria-label={t('designer_team_link', 'Team link')}
              readOnly
              disableForm
              removeError
              value={teamUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="h-[38px] bg-newBgColor"
            />
          </div>
          <Button className="mt-[25px]" onClick={() => copy('team', teamUrl)}>
            {copied === 'team' ? t('copied', 'Copied') : t('copy_link', 'Copy link')}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-studioBorder pt-4">
        <div>
          <h3 className="text-[13px] font-medium text-textColor">{t('designer_client_preview_link', 'Client preview link')}</h3>
          <p className="text-[11px] text-newTextColor/60">
            {t('designer_client_preview_hint', 'Anyone with this link can view the latest saved design without an account.')}
          </p>
        </div>
        {isLoading && <p className="text-[12px] text-newTextColor/60">{t('loading_ellipsis', 'Loading…')}</p>}
        {error && !share && (
          <p className="text-[12px] text-dangerText">{t('designer_share_settings_unavailable', 'Client sharing settings are unavailable for your role.')}</p>
        )}
        {!isLoading && !error && (
          <>
            {share?.enabled && (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    name="clientLink"
                    label={t('designer_client_preview_link', 'Client preview link')}
                    aria-label={t('designer_client_preview_link', 'Client preview link')}
                    readOnly
                    disableForm
                    removeError
                    value={clientUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    className="h-[38px] bg-newBgColor"
                  />
                </div>
                <Button className="mt-[25px]" onClick={() => copy('client', clientUrl)}>
                  {copied === 'client' ? t('copied', 'Copied') : t('copy_link', 'Copy link')}
                </Button>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3">
              <Input
                name="expiryDate"
                type="date"
                label={t('designer_share_expiry', 'Expiry date')}
                aria-label={t('designer_share_expiry', 'Expiry date')}
                disableForm
                removeError
                value={expiryDate}
                min={dayjs().add(1, 'day').format('YYYY-MM-DD')}
                max={dayjs().add(364, 'day').format('YYYY-MM-DD')}
                onChange={(event) => setExpiryDate(event.target.value)}
                className="h-[38px]"
              />
              <div className="flex items-end pb-[9px] text-[12px] text-textColor">
                <Checkbox
                  name="commentsEnabled"
                  disableForm
                  checked={commentsEnabled}
                  label={t('designer_allow_comments', 'Allow client comments')}
                  onChange={(event) => setCommentsEnabled(event.target.value)}
                />
              </div>
            </div>
            {share && (
              <p className="text-[11px] text-newTextColor/60">
                {t('designer_share_expires_on', 'Link expires on {{date}}.', { date: formatDesignShareDate(share.expiresAt, i18next.resolvedLanguage) })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button loading={busy} onClick={() => saveClient(true)}>
                {share?.enabled
                  ? t('designer_save_sharing_settings', 'Save settings')
                  : t('designer_enable_client_link', 'Enable client link')}
              </Button>
              {share?.enabled && (
                <Button secondary loading={busy} onClick={disableClient}>
                  {t('designer_disable_client_link', 'Disable link')}
                </Button>
              )}
            </div>
          </>
        )}
        {actionError && <p className="text-[12px] text-dangerText">{actionError}</p>}
        {share?.approvedAt && (
          <p className="rounded-md bg-positive/10 px-3 py-2 text-[12px] text-positive">
            {t('designer_approved_by_on', 'Approved by {{name}} on {{date}}.', {
              name: share.approvedBy || t('designer_client', 'Client'),
              date: formatDesignShareDate(share.approvedAt, i18next.resolvedLanguage),
              interpolation: { escapeValue: false },
            })}
          </p>
        )}
        {!!share?.comments.length && (
          <div className="flex max-h-[160px] flex-col gap-2 overflow-y-auto rounded-md border border-studioBorder p-3">
            <h4 className="text-[12px] font-medium text-textColor">{t('designer_client_feedback', 'Client feedback')}</h4>
            {share.comments.map((comment) => (
              <div key={comment.id} className="text-[12px]">
                <span className="font-medium text-textColor">{comment.authorName}</span>
                <span className="text-newTextColor/50"> · {formatDesignShareDate(comment.createdAt, i18next.resolvedLanguage)}</span>
                <p className="whitespace-pre-wrap text-newTextColor/75">{comment.content}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex items-center justify-between gap-3 border-t border-studioBorder pt-4">
        <div>
          <h3 className="text-[12px] font-medium text-textColor">
            {t('designer_realtime_collaboration', 'Real-time collaboration')}
          </h3>
          <p className="max-w-[310px] text-[11px] text-newTextColor/60">
            {t('designer_collaboration_hint', 'When enabled, team members with Can edit can see each other’s cursors and changes in real time.')}
          </p>
          <p className="mt-1 text-[11px] text-newTextColor/60">
            {collabEnabled
              ? t('peers_connected_count', '{{count}} connected', { count: connectedCount })
              : t('designer_collaboration_off', 'Collaboration is off')}
          </p>
        </div>
        <Button secondary onClick={toggle}>
          {collabEnabled ? t('designer_stop_sharing', 'Stop Sharing') : t('designer_enable_sharing', 'Enable collaboration')}
        </Button>
      </section>
    </div>
  );
};

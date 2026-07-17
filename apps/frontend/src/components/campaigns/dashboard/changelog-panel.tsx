'use client';

import { FC, useMemo } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface AuditLog {
  id: string;
  action: string;
  entityName?: string | null;
  details?: string | null;
  createdAt: string;
  user?: { name?: string | null; email?: string | null } | null;
  userId?: string | null;
}

interface ChangelogPanelProps {
  logs: AuditLog[];
}

const parseDetails = (details?: string | null): Record<string, any> => {
  if (!details) return {};
  try {
    return JSON.parse(details);
  } catch {
    return {};
  }
};

export const ChangelogPanel: FC<ChangelogPanelProps> = ({ logs }) => {
  const t = useT();

  const items = useMemo(() => {
    return (logs || []).map((log) => {
      const details = parseDetails(log.details);
      const userName = log.user?.name || log.user?.email || log.userId || '';
      let text = '';

      switch (log.action) {
        case 'campaign.item.add':
          text = t(
            'changelog_item_add',
            '{user} added this campaign to {itemName}',
            { user: userName, itemName: details.itemName || t('unknown_item', 'an item') }
          );
          break;
        case 'campaign.item.remove':
          text = t(
            'changelog_item_remove',
            '{user} removed this campaign from {itemName}',
            { user: userName, itemName: details.itemName || t('unknown_item', 'an item') }
          );
          break;
        case 'campaign.copy':
          text = t(
            'changelog_copy',
            '{user} copied this campaign from {sourceName}',
            { user: userName, sourceName: details.sourceName || t('unknown_campaign', 'another campaign') }
          );
          break;
        case 'campaign.promote':
          text = t(
            'changelog_promote',
            '{user} promoted {count} drafts',
            { user: userName, count: Number(details.count || 0) }
          );
          break;
        case 'campaign.draft.approve':
          text = t(
            'changelog_draft_approve',
            '{user} approved a draft',
            { user: userName }
          );
          break;
        case 'campaign.draft.reject':
          text = t(
            'changelog_draft_reject',
            '{user} rejected a draft',
            { user: userName }
          );
          break;
        default:
          text = t(
            'changelog_fallback',
            '{user} performed {action}',
            { user: userName, action: log.action }
          );
      }

      return {
        id: log.id,
        text,
        date: dayjs(log.createdAt).fromNow(),
        fullDate: dayjs(log.createdAt).format(t('changelog_date_format', 'MMM D, YYYY h:mm A')),
      };
    });
  }, [logs, t]);

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor">
      <h3 className="text-[16px] font-semibold text-textColor mb-[12px]">{t('changelog', 'Changelog')}</h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-newTableText">{t('changelog_empty', 'No recent activity.')}</p>
      ) : (
        <ul className="flex flex-col gap-[10px]">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-[8px] text-[13px]">
              <span className="mt-[6px] w-[6px] h-[6px] rounded-full bg-btnPrimary flex-shrink-0" />
              <div className="flex flex-col gap-[2px]">
                <span className="text-textColor">{item.text}</span>
                <span className="text-[11px] text-newTableText" title={item.fullDate}>
                  {item.date}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

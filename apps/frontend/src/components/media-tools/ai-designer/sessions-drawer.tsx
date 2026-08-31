'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import { Drawer } from '@postmill-ai/frontend/components/analytics/kit/drawer';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { LoadingRows } from '@postmill-ai/frontend/components/ui/loading-rows';
import { EmptyState } from '@postmill-ai/frontend/components/ui/empty-state';
import {
  useAiDesignerSessions,
  useDeleteAiDesignerSession,
} from './ai-designer.hooks';
import type { AiDesignerSessionDto } from '@postmill-ai/nestjs-libraries/ai-designer/ai-designer.types';

/** Coarse relative time — the exact minute never matters in a history list. */
const relativeTime = (iso: string, t: ReturnType<typeof useT>): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('just_now', 'Just now');
  if (mins < 60) return t('minutes_ago', '{{count}}m ago', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('hours_ago', '{{count}}h ago', { count: hours });
  const days = Math.floor(hours / 24);
  return t('days_ago', '{{count}}d ago', { count: days });
};

/**
 * A session has no title column, so the brief's intent is the only human label —
 * and `brief` is null until intake produces one.
 */
const sessionLabel = (
  session: AiDesignerSessionDto,
  t: ReturnType<typeof useT>
): string => session.brief?.intent?.trim() || t('untitled_design', 'Untitled design');

const formatCount = (session: AiDesignerSessionDto): number =>
  (session.config?.channels?.length || 0) + (session.config?.customSizes?.length || 0);

const formatLabel = (count: number, t: ReturnType<typeof useT>): string =>
  count === 1
    ? t('one_format', '1 format')
    : t('n_formats_count', '{{count}} formats', { count });

/**
 * Session state as a colour rather than a raw word — `intake` / `designing` /
 * `delivered` read like debug output in a list, but "is it finished" is the
 * only thing you actually scan for.
 */
const stateDot = (state: string): string => {
  if (state === 'delivered') return 'bg-(--positive,#32d583)';
  if (state === 'error' || state === 'cancelled') return 'bg-newTableText';
  return 'bg-designerAccent';
};

export const AiDesignerSessionsDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  activeSessionId: string | null;
  onResume: (sessionId: string) => void;
  /** Called when the session currently open is deleted. */
  onActiveDeleted: () => void;
}> = ({ open, onClose, activeSessionId, onResume, onActiveDeleted }) => {
  const t = useT();
  const toaster = useToaster();
  const { data, isLoading, mutate } = useAiDesignerSessions();
  const deleteSession = useDeleteAiDesignerSession();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleDelete = async (session: AiDesignerSessionDto) => {
    setBusyId(session.id);
    try {
      await deleteSession(session.id);
      await mutate();
      toaster.show(t('session_deleted', 'Session deleted'), 'success');
      if (session.id === activeSessionId) onActiveDeleted();
    } catch {
      toaster.show(t('failed_to_delete_session', 'Could not delete that session'), 'warning');
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const sessions = data?.sessions || [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      ariaLabel={t('previous_sessions', 'Previous sessions')}
      panelClassName="w-[380px] max-w-[92vw]"
    >
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-[16px] h-[52px] shrink-0 border-b border-studioBorder">
          <h2 className="text-[14px] font-[600] text-textColor">
            {t('previous_sessions', 'Previous sessions')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close', 'Close')}
            className="w-[28px] h-[28px] flex items-center justify-center rounded-[6px] text-newTableText hover:text-textColor hover:bg-boxHover transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-[12px]">
          {isLoading ? (
            <LoadingRows rows={5} columns={1} />
          ) : sessions.length === 0 ? (
            <EmptyState
              title={t('no_previous_sessions', 'No previous sessions')}
              description={t(
                'no_previous_sessions_description',
                'Designs you start will show up here so you can pick them back up.'
              )}
            />
          ) : (
            <ul className="flex flex-col gap-[4px]">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const count = formatCount(session);
                const confirming = confirmId === session.id;

                return (
                  <li key={session.id}>
                    <div
                      className={clsx(
                        'group relative rounded-[10px] border transition-colors',
                        isActive
                          ? 'border-designerAccent bg-designerAccent/10'
                          : 'border-transparent hover:border-studioBorder hover:bg-boxHover'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onResume(session.id);
                          onClose();
                        }}
                        aria-current={isActive ? 'true' : undefined}
                        className="w-full text-start ps-[12px] pe-[34px] py-[10px] flex flex-col gap-[3px]"
                      >
                        <span className="text-[13px] leading-[1.35] font-[500] text-textColor line-clamp-2">
                          {sessionLabel(session, t)}
                        </span>
                        {confirming ? (
                          <span className="text-[11px] text-newTableText">
                            {t('delete_session_confirm', 'Delete this session?')}
                          </span>
                        ) : (
                          <span className="text-[11px] text-newTableText flex items-center gap-[5px]">
                            <span
                              aria-hidden="true"
                              className={clsx('w-[5px] h-[5px] rounded-full shrink-0', stateDot(session.state))}
                            />
                            {count > 0 && (
                              <>
                                <span>{formatLabel(count, t)}</span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span>{relativeTime(session.updatedAt, t)}</span>
                          </span>
                        )}
                      </button>

                      {confirming ? (
                        <span className="absolute top-[8px] inset-e-[8px] flex items-center gap-[8px] text-[11px]">
                          <button
                            type="button"
                            disabled={busyId === session.id}
                            onClick={() => handleDelete(session)}
                            className="text-dangerText font-[600] disabled:opacity-50"
                          >
                            {t('delete', 'Delete')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="text-newTableText hover:text-textColor"
                          >
                            {t('cancel', 'Cancel')}
                          </button>
                        </span>
                      ) : (
                        // Hidden until hover/focus so a list of these reads as
                        // titles, not as a column of Delete links.
                        <button
                          type="button"
                          onClick={() => setConfirmId(session.id)}
                          aria-label={t('delete_session', 'Delete session')}
                          className="absolute top-[8px] inset-e-[8px] w-[24px] h-[24px] rounded-[6px] flex items-center justify-center text-newTableText opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-dangerText hover:bg-studioBorder/60 transition-all"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
};

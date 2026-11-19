'use client';

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import SafeImage from '@postmill-ai/react/helpers/safe.image';
import { Button } from '@postmill-ai/react/form/button';
import { Input } from '@postmill-ai/react/form/input';
import { Textarea } from '@postmill-ai/react/form/textarea';
import { useT, useTranslationSettings } from '@postmill-ai/react/translation/get.transation.service.client';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useVariables } from '@postmill-ai/react/helpers/variable.context';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import { PreviewImage } from './preview-image-cache';
import {
  backendResourceUrl,
  designPreviewImageUrl,
  formatDesignShareDate,
  usePublicDesignPreview,
  useTeamDesignPreview,
  type DesignPreviewData,
} from './design-sharing';

export const DesignPreviewView: FC<{
  data: DesignPreviewData;
  imageBaseUrl: string;
  publicMode?: boolean;
  onComment?: (name: string, content: string) => Promise<void>;
  onApprove?: (name: string) => Promise<void>;
}> = ({ data, imageBaseUrl, publicMode = false, onComment, onApprove }) => {
  const t = useT();
  const i18next = useTranslationSettings();
  const [outputIndex, setOutputIndex] = useState(data.outputs[0]?.outputIndex ?? 0);
  const [pageNumber, setPageNumber] = useState(0);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'comment' | 'approve' | null>(null);
  const [actionError, setActionError] = useState('');
  const imageCache = useRef(new Map<string, Blob>());
  const output = data.outputs.find((item) => item.outputIndex === outputIndex) ?? data.outputs[0];
  const page = output?.pages.find((item) => item.pageNumber === pageNumber) ?? output?.pages[0];

  useEffect(() => {
    if (!output) setOutputIndex(data.outputs[0]?.outputIndex ?? 0);
    if (!page) setPageNumber(output?.pages[0]?.pageNumber ?? 0);
  }, [data, output, page]);

  const imageUrl = output && page
    ? designPreviewImageUrl(imageBaseUrl, output.outputIndex, page.pageNumber)
    : '';

  const outputItems = useMemo(() => data.outputs.map((item) => ({
    key: String(item.outputIndex),
    label: item.name,
  })), [data.outputs]);
  const pageItems = useMemo(() => (output?.pages ?? []).map((item) => ({
    key: String(item.pageNumber),
    label: item.name,
  })), [output]);

  const submitComment = async () => {
    if (!onComment || !name.trim() || !comment.trim()) return;
    setBusy('comment');
    setActionError('');
    try {
      await onComment(name.trim(), comment.trim());
      setComment('');
    } catch {
      setActionError(t('designer_comment_failed', 'Could not post the comment. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!onApprove || !name.trim()) {
      setActionError(t('designer_approval_name_required', 'Enter your name before approving.'));
      return;
    }
    setBusy('approve');
    setActionError('');
    try {
      await onApprove(name.trim());
    } catch {
      setActionError(t('designer_approval_failed', 'Could not record approval. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-full bg-newBgColor text-textColor">
      <header className="border-b border-studioBorder bg-newBgColorInner px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-[20px] font-semibold">{data.name}</h1>
            <p className="text-[12px] text-newTextColor/60">{t('designer_view_only', 'View-only design preview')}</p>
          </div>
          {data.expiresAt && (
            <p className="text-[12px] text-newTextColor/60">
              {t('designer_preview_expires', 'Preview expires {{date}}', { date: formatDesignShareDate(data.expiresAt, i18next.resolvedLanguage) })}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] grid-cols-1 gap-5 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 rounded-[12px] border border-newTableBorder bg-newBgColorInner p-3 md:p-5" aria-label={t('designer_design_preview', 'Design preview')}>
          {outputItems.length > 1 && (
            <OverflowTabs
              items={outputItems}
              activeKey={String(output?.outputIndex ?? 0)}
              onSelect={(key) => {
                setOutputIndex(Number(key));
                setPageNumber(0);
              }}
              variant="outline"
              semantics="tabs"
              ariaLabel={t('designer_more_formats', 'More formats')}
              listAriaLabel={t('designer_formats', 'Design formats')}
            />
          )}
          {pageItems.length > 1 && (
            <div className="mt-3">
              <OverflowTabs
                items={pageItems}
                activeKey={String(page?.pageNumber ?? 0)}
                onSelect={(key) => setPageNumber(Number(key))}
                variant="pill"
                semantics="tabs"
                ariaLabel={t('designer_more_pages', 'More pages')}
                listAriaLabel={t('designer_pages', 'Design pages')}
              />
            </div>
          )}
          <div className="mt-4 flex min-h-[320px] items-center justify-center overflow-hidden rounded-md bg-studioCanvas p-3">
            {imageUrl ? (
              <PreviewImage
                key={imageUrl}
                imageUrl={imageUrl}
                cache={imageCache.current}
                alt={t('designer_preview_alt', '{{name}} — {{page}}', {
                  name: data.name,
                  page: page?.name || t('designer_poster', 'Poster'),
                  interpolation: { escapeValue: false },
                })}
                width={output?.width ?? 1080}
                height={output?.height ?? 1080}
              />
            ) : (
              <p className="text-[13px] text-newTextColor/60">{t('loading_ellipsis', 'Loading…')}</p>
            )}
          </div>
          {data.mode === 'video' && (
            <p className="mt-2 text-[11px] text-newTextColor/60">{t('designer_video_poster_hint', 'Video designs show their opening poster frame.')}</p>
          )}
        </section>

        <aside className="flex flex-col gap-4 rounded-[12px] border border-newTableBorder bg-newBgColorInner p-4" aria-label={t('designer_feedback_and_approval', 'Feedback and approval')}>
          <div>
            <h2 className="text-[15px] font-semibold">{t('designer_feedback_and_approval', 'Feedback and approval')}</h2>
            <p className="text-[12px] text-newTextColor/60">
              {publicMode
                ? t('designer_public_feedback_hint', 'Share feedback or approve this design. No account is required.')
                : t('designer_team_feedback_hint', 'Client feedback and approval appear here when available.')}
            </p>
          </div>

          {data.approvedAt ? (
            <div className="rounded-md bg-positive/10 p-3 text-[12px] text-positive">
              <strong>{t('designer_approved', 'Approved')}</strong>
              <p>{t('designer_approved_by_on', 'Approved by {{name}} on {{date}}.', {
                name: data.approvedBy || t('designer_client', 'Client'),
                date: formatDesignShareDate(data.approvedAt, i18next.resolvedLanguage),
                interpolation: { escapeValue: false },
              })}</p>
            </div>
          ) : publicMode && (
            <Button loading={busy === 'approve'} onClick={approve}>{t('designer_approve', 'Approve')}</Button>
          )}

          {publicMode && (!data.approvedAt || data.commentsEnabled) && (
            <Input
              name="reviewerName"
              label={t('your_name', 'Your name')}
              aria-label={t('your_name', 'Your name')}
              disableForm
              removeError
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}

          <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto">
            {data.comments.length === 0 ? (
              <p className="text-[12px] text-newTextColor/60">{t('designer_no_feedback', 'No client feedback yet.')}</p>
            ) : data.comments.map((item) => (
              <article key={item.id} className="border-b border-newTableBorder pb-3 last:border-0">
                <div className="text-[12px]">
                  <strong>{item.authorName}</strong>
                  <span className="text-newTextColor/50"> · {formatDesignShareDate(item.createdAt, i18next.resolvedLanguage)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-newTextColor/80">{item.content}</p>
              </article>
            ))}
          </div>

          {publicMode && data.commentsEnabled && onComment && (
            <form
              className="flex flex-col gap-2 border-t border-newTableBorder pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitComment();
              }}
            >
              <Textarea
                name="comment"
                label={t('designer_leave_comment', 'Leave a comment')}
                aria-label={t('designer_leave_comment', 'Leave a comment')}
                disableForm
                required
                maxLength={2000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="min-h-[100px] bg-newBgColor text-textColor"
              />
              <Button type="submit" loading={busy === 'comment'} disabled={!name.trim() || !comment.trim()}>
                {t('designer_post_comment', 'Post comment')}
              </Button>
            </form>
          )}
          {actionError && <p className="text-[12px] text-dangerText">{actionError}</p>}
        </aside>
      </main>
    </div>
  );
};

const PreviewUnavailable: FC = () => {
  const t = useT();
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-newBgColor p-6 text-center text-[14px] text-dangerText">
      {t('designer_preview_unavailable', 'This design preview is unavailable or has expired.')}
    </div>
  );
};

const PreviewLoading: FC = () => {
  const t = useT();
  return <div className="min-h-[60vh] bg-newBgColor p-6 text-center text-textColor">{t('loading_ellipsis', 'Loading…')}</div>;
};

export const TeamDesignPreview: FC<{ designId?: string }> = ({ designId }) => {
  const { data, error, isLoading } = useTeamDesignPreview(designId);
  const { backendUrl } = useVariables();
  if (error) return <PreviewUnavailable />;
  if (isLoading || !data) return <PreviewLoading />;
  const base = backendResourceUrl(backendUrl, window.location.origin, `/media/designs/${designId}/preview`);
  return <DesignPreviewView data={data} imageBaseUrl={base} />;
};

export const PublicDesignPreview: FC<{ token?: string }> = ({ token }) => {
  const fetch = useFetch();
  const { data, error, isLoading, mutate } = usePublicDesignPreview(token);
  const { backendUrl } = useVariables();
  if (error) return <PreviewUnavailable />;
  if (isLoading || !data || !token) return <PreviewLoading />;
  const base = backendResourceUrl(backendUrl, window.location.origin, `/public/design-share/${token}/preview`);
  const mutatePreview = async (response: Response) => {
    if (!response.ok) throw new Error('Preview action failed');
    await mutate();
  };
  return (
    <DesignPreviewView
      data={data}
      imageBaseUrl={base}
      publicMode
      onComment={async (name, content) => {
        await mutatePreview(await fetch(`/public/design-share/${token}/comments`, {
          method: 'POST',
          body: JSON.stringify({ name, content }),
        }));
      }}
      onApprove={async (name) => {
        await mutatePreview(await fetch(`/public/design-share/${token}/approve`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        }));
      }}
    />
  );
};

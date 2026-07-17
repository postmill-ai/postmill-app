'use client';

import React, { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface CommentComposerProps {
  postId: string;
  replyToCommentId?: string;
  onClose: () => void;
  integrationName: string;
  onSubmitted: () => void;
  parentCommentText?: string;
}

const humanizeAiError = (
  t: ReturnType<typeof useT>,
  status: number,
  body: any
): React.ReactNode => {
  if (status === 429) {
    const message = body?.message || body?.error;
    return t('ai_rate_limited', 'Rate limited: {{message}}', {
      message:
        message ||
        t('please_try_again_later', 'please try again later.'),
    });
  }
  if (status === 403) {
    const policy = body?.policy;
    return policy
      ? t('ai_blocked_by_guardrail_policy', 'AI blocked by guardrail policy: {{policy}}', {
          policy,
        })
      : t(
          'ai_blocked_by_content_guardrail',
          'AI request blocked by content guardrail.'
        );
  }
  if (status === 422 || body?.error === 'CapabilityNotAvailable') {
    return t(
      'ai_comment_drafting_unavailable',
      'AI comment drafting is not available on this provider.'
    );
  }
  if (status === 402) {
    return (
      <>
        {t(
          'feature_not_available_on_plan',
          'This feature is not available on your plan — upgrade to unlock it.'
        )}{' '}
        <a href="/billing" className="underline hover:text-textColor">
          {t('upgrade_now', 'Upgrade now')}
        </a>
      </>
    );
  }
  return t('ai_draft_failed', 'AI draft failed. Please try again.');
};

export const CommentComposer: FC<CommentComposerProps> = ({
  postId,
  replyToCommentId,
  onClose,
  integrationName,
  onSubmitted,
  parentCommentText,
}) => {
  const t = useT();
  const fetch = useFetch();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<React.ReactNode>('');
  const [aiLoading, setAiLoading] = useState(false);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const url = replyToCommentId
        ? `/posts/${postId}/social-comments/${replyToCommentId}/reply`
        : `/posts/${postId}/social-comments`;
      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!res.ok) {
        const text = await res.text();
        const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(text);
        throw new Error(!text || looksLikeHtml ? '' : text);
      }
      setMessage('');
      onSubmitted();
    } catch (err: any) {
      setError(err.message || t('failed_to_send', 'Failed to send reply'));
    } finally {
      setSending(false);
    }
  };

  const handleAiDraft = useCallback(async () => {
    setAiLoading(true);
    setError('');
    try {
      const res = await fetch('/ai/comment-reply', {
        method: 'POST',
        body: JSON.stringify({
          commentId: replyToCommentId || '',
          postContent: parentCommentText || '',
        }),
      });
      if (!res.ok) {
        let body: any = null;
        try {
          body = await res.json();
        } catch {}
        throw { status: res.status, body };
      }
      const data = await res.json();
      setMessage(data.suggestion || '');
    } catch (err: any) {
      if (err.status) {
        setError(humanizeAiError(t, err.status, err.body));
      } else {
        setError(t('ai_draft_failed', 'AI draft failed. Please try again.'));
      }
    } finally {
      setAiLoading(false);
    }
  }, [fetch, replyToCommentId, parentCommentText, t]);

  return (
    <div className="flex flex-col gap-[6px] mt-[8px]">
      <div className="text-[11px] text-newTableText">
        {t('replying_as', 'Replying as')} {integrationName}
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSend();
          }
        }}
        aria-label={t('reply_input', 'Reply')}
        placeholder={t('write_a_reply', 'Write a reply...')}
        rows={2}
        className="bg-newBgColor border border-newTableBorder rounded-[6px] px-[10px] py-[6px] text-[13px] text-textColor outline-none resize-none"
      />
      {error && (
        <div className="text-[12px] text-red-500" role="alert">{error}</div>
      )}
      <div className="flex flex-col gap-[6px]">
        <div className="flex gap-[6px]">
          <button
            type="button"
            onClick={handleAiDraft}
            disabled={aiLoading || sending}
            className="text-[12px] text-btnPrimaryAccent hover:underline disabled:opacity-50"
          >
            {aiLoading
              ? t('ai_drafting', '✨ Drafting...')
              : t('ai_draft', '✨ Draft with AI')}
          </button>
          <button
            type="button"
            onClick={async () => {
              setAiLoading(true);
              setError('');
              try {
                const res = await fetch('/ai/comment-reply', {
                  method: 'POST',
                  body: JSON.stringify({
                    postId,
                    action: 'summary',
                  }),
                });
                if (!res.ok) throw { status: res.status, body: await res.json().catch(() => null) };
                const data = await res.json();
                setMessage(data.suggestion || '');
              } catch (err: any) {
                if (err.status) {
                  setError(humanizeAiError(t, err.status, err.body));
                } else {
                  setError(t('summarize_failed', 'Summarize failed. Please try again.'));
                }
              } finally {
                setAiLoading(false);
              }
            }}
            disabled={aiLoading || sending}
            className="text-[12px] text-btnPrimaryAccent hover:underline disabled:opacity-50"
          >
            {aiLoading
              ? t('summarizing', '📋 Summarizing...')
              : t('summarize', '📋 Summarize')}
          </button>
        </div>
        <div className="flex gap-[6px] justify-between items-center">
          <div />
          <div className="flex gap-[6px]">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="text-[12px] text-newTableText hover:text-textColor px-[10px] py-[4px] disabled:opacity-50"
            >
              {t('cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!message.trim() || sending}
              className="bg-btnPrimary text-white text-[12px] rounded-[6px] px-[14px] py-[4px] disabled:opacity-50"
            >
              {sending
                ? t('sending', 'Sending...')
                : t('send', 'Send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

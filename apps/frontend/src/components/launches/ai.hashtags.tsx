'use client';

import { Button } from '@gitroom/react/form/button';
import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import Loading from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { AiErrorDisplay } from '@gitroom/frontend/components/ai/ai-error-display';

const platforms = [
  'Instagram',
  'Twitter/X',
  'LinkedIn',
  'Facebook',
  'TikTok',
  'YouTube',
  'Threads',
  'Pinterest',
] as const;

interface HashtagsProps {
  onSelect?: (hashtags: string[]) => void;
}

const HashtagsModal: FC<{ close: () => void; onSelect?: (hashtags: string[]) => void }> = (props) => {
  const { close, onSelect } = props;
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();

  const [content, setContent] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('Instagram');
  const [loading, setLoading] = useState(false);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<any>(null);

  const toggleTag = (tag: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const generateHashtags = useCallback(async () => {
    if (!content.trim()) {
      toaster.show(
        t('please_enter_content', 'Please enter some content'),
        'warning',
      );
      return;
    }

    setLoading(true);
    setError(null);
    setHashtags([]);
    setSelected(new Set());

    try {
      const platformKey = selectedPlatform === 'Twitter/X' ? 'twitter' : selectedPlatform.toLowerCase();
      const res = await fetch('/ai/hashtags', {
        method: 'POST',
        body: JSON.stringify({ content, platform: platformKey }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({
          message: t('request_failed', 'Request failed'),
        }));
        setError(err);
        return;
      }

      const data = await res.json();
      setHashtags(data.hashtags || []);
    } catch {
      setError(
        t('network_error_please_try_again', 'Network error — please try again')
      );
    } finally {
      setLoading(false);
    }
  }, [content, selectedPlatform, fetch, toaster, t]);

  const copyAll = () => {
    const text = [...selected]
      .map((h) => `#${h}`)
      .join(' ');
    navigator.clipboard.writeText(text);
    toaster.show(
      t('copied_to_clipboard', 'Copied to clipboard'),
      'success',
    );
  };

  const applySelected = () => {
    onSelect?.([...selected]);
    close();
  };

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">{t('content', 'Content')}</div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t('enter_your_post_content', 'Enter your post content...')}
          className="bg-input min-h-[80px] p-[16px] outline-none border-newTableBorder border rounded-[4px] text-inputText placeholder-inputText"
        />
      </div>

      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">{t('platform', 'Platform')}</div>
        <div className="flex flex-wrap gap-[8px]">
          {platforms.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSelectedPlatform(p)}
              className={clsx(
                'cursor-pointer rounded-[4px] px-[10px] h-[30px] flex items-center text-[12px] border',
                selectedPlatform === p
                  ? 'bg-btnPrimary border-btnPrimary text-white'
                  : 'bg-newColColor border-newBgLineColor',
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex">
        <Button
          type="button"
          onClick={generateHashtags}
          className="flex-1"
          disabled={loading}
        >
          {loading ? (
            <Loading height={16} width={16} type="spin" color="#fff" />
          ) : (
            t('generate_hashtags', 'Generate Hashtags')
          )}
        </Button>
      </div>

      {error && (
        <AiErrorDisplay error={error} onDismiss={() => setError(null)} />
      )}

      {hashtags.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          <div className="flex gap-[6px]">
            <button
              type="button"
              onClick={copyAll}
              className="text-[12px] text-btnPrimaryAccent hover:underline"
            >
              {t('copy_selected', 'Copy Selected')}
            </button>
            {onSelect && selected.size > 0 && (
              <button
                type="button"
                onClick={applySelected}
                className="text-[12px] text-btnPrimaryAccent hover:underline"
              >
                {t('apply_to_post', 'Apply to Post')}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-[6px]">
            {hashtags.map((tag) => {
              const isSelected = selected.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={clsx(
                    'cursor-pointer rounded-[4px] px-[8px] h-[28px] flex items-center text-[12px] border transition-all',
                    isSelected
                      ? 'bg-btnPrimary border-btnPrimary text-white'
                      : 'bg-newColColor border-newBgLineColor hover:border-btnPrimary',
                  )}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const AiHashtags: FC<HashtagsProps> = ({ onSelect }) => {
  const t = useT();
  const modals = useModals();

  const openModal = useCallback(() => {
    modals.openModal({
      title: t('ai_hashtags', 'AI Hashtags'),
      children: (close) => (
        <HashtagsModal close={close} onSelect={onSelect} />
      ),
    });
  }, [modals, t, onSelect]);

  return (
    <button
      type="button"
      onClick={openModal}
      aria-label={t('hashtags', 'Hashtags')}
      className="cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px]"
    >
      <div className="flex gap-[5px] items-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9h16" />
          <path d="M4 15h16" />
          <path d="M10 3L8 21" />
          <path d="M16 3l-2 18" />
        </svg>
        <div className="text-[10px] font-[600] iconBreak:hidden block">
          {t('hashtags', 'Hashtags')}
        </div>
      </div>
    </button>
  );
};

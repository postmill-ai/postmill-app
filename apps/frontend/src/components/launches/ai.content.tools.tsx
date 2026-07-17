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
import { AiHashtags } from './ai.hashtags';

const tabs = ['Repurpose', 'Translate', 'A/B Variants', 'Hashtags'] as const;
type Tab = (typeof tabs)[number];

const platforms = [
  'Twitter/X',
  'LinkedIn',
  'Instagram',
  'Facebook',
  'Threads',
  'Mastodon',
  'Blog',
] as const;

const locales = [
  { key: 'en', label: 'English' },
  { key: 'es', label: 'Spanish' },
  { key: 'fr', label: 'French' },
  { key: 'de', label: 'German' },
  { key: 'it', label: 'Italian' },
  { key: 'pt', label: 'Portuguese' },
  { key: 'ja', label: 'Japanese' },
  { key: 'ko', label: 'Korean' },
  { key: 'zh', label: 'Chinese' },
  { key: 'ar', label: 'Arabic' },
  { key: 'hi', label: 'Hindi' },
  { key: 'nl', label: 'Dutch' },
] as const;

const ContentToolsModal: FC<{ close: () => void }> = (props) => {
  const { close } = props;
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [activeTab, setActiveTab] = useState<Tab>('Repurpose');

  const [content, setContent] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedLocales, setSelectedLocales] = useState<string[]>([]);
  const [variantCount, setVariantCount] = useState(3);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  const togglePlatform = (p: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const toggleLocale = (l: string) => {
    setSelectedLocales((prev) =>
      prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]
    );
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toaster.show(
      t('copied_to_clipboard', 'Copied to clipboard'),
      'success'
    );
  };

  const runAction = useCallback(async () => {
    if (!content.trim()) {
      toaster.show(
        t('please_enter_content', 'Please enter some content'),
        'warning'
      );
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      let res: Response;

      if (activeTab === 'Repurpose') {
        if (selectedPlatforms.length === 0) {
          toaster.show(
            t('select_at_least_one_platform', 'Select at least one platform'),
            'warning'
          );
          setLoading(false);
          return;
        }
        const keys = selectedPlatforms.map((p) =>
          p === 'Twitter/X' ? 'twitter' : p.toLowerCase()
        );
        res = await fetch('/ai/repurpose', {
          method: 'POST',
          body: JSON.stringify({ content, platforms: keys }),
        });
      } else if (activeTab === 'Translate') {
        if (selectedLocales.length === 0) {
          toaster.show(
            t('select_at_least_one_locale', 'Select at least one locale'),
            'warning'
          );
          setLoading(false);
          return;
        }
        res = await fetch('/ai/translate', {
          method: 'POST',
          body: JSON.stringify({ content, locales: selectedLocales }),
        });
      } else {
        res = await fetch('/ai/variants', {
          method: 'POST',
          body: JSON.stringify({ content, count: variantCount }),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({
          message: t('request_failed', 'Request failed'),
        }));
        setError(err);
        return;
      }

      setResults(await res.json());
    } catch {
      setError(
        t('network_error_please_try_again', 'Network error — please try again')
      );
    } finally {
      setLoading(false);
    }
  }, [
    activeTab,
    content,
    selectedPlatforms,
    selectedLocales,
    variantCount,
    fetch,
    toaster,
    t,
  ]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex gap-[4px] bg-newBgColor rounded-[8px] p-[4px]">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setResults(null);
              setError(null);
            }}
            className={clsx(
              'm-0 p-0 border-0 bg-transparent cursor-pointer rounded-[6px] px-[12px] h-[32px] flex items-center text-[12px] font-[500] transition-all',
              activeTab === tab
                ? 'bg-[#2B5CD3] text-white'
                : 'text-newTextColor/60 hover:text-newTextColor'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">{t('content', 'Content')}</div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t(
            'enter_your_post_content',
            'Enter your post content...'
          )}
          className="bg-input min-h-[120px] p-[16px] outline-none border-newTableBorder border rounded-[4px] text-inputText placeholder-inputText"
        />
      </div>

      {activeTab === 'Repurpose' && (
        <div className="flex flex-col gap-[6px]">
          <div className="text-[14px]">{t('platforms', 'Platforms')}</div>
          <div className="flex flex-wrap gap-[8px]">
            {platforms.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => togglePlatform(p)}
                className={clsx(
                  'm-0 p-0 border-0 bg-transparent cursor-pointer rounded-[4px] px-[10px] h-[30px] flex items-center text-[12px] border',
                  selectedPlatforms.includes(p)
                    ? 'bg-[#2B5CD3] border-[#2B5CD3] text-white'
                    : 'bg-newColColor border-newBgLineColor'
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'Translate' && (
        <div className="flex flex-col gap-[6px]">
          <div className="text-[14px]">{t('locales', 'Locales')}</div>
          <div className="flex flex-wrap gap-[8px]">
            {locales.map((l) => (
              <button
                type="button"
                key={l.key}
                onClick={() => toggleLocale(l.key)}
                className={clsx(
                  'm-0 p-0 border-0 bg-transparent cursor-pointer rounded-[4px] px-[10px] h-[30px] flex items-center text-[12px] border',
                  selectedLocales.includes(l.key)
                    ? 'bg-[#2B5CD3] border-[#2B5CD3] text-white'
                    : 'bg-newColColor border-newBgLineColor'
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'A/B Variants' && (
        <div className="flex flex-col gap-[6px]">
          <div className="text-[14px]">
            {t('number_of_variants', 'Number of Variants')}
          </div>
          <div className="flex gap-[8px]">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                type="button"
                key={n}
                onClick={() => setVariantCount(n)}
                className={clsx(
                  'm-0 p-0 border-0 bg-transparent cursor-pointer rounded-[4px] w-[36px] h-[30px] flex items-center justify-center text-[12px] border',
                  variantCount === n
                    ? 'bg-[#2B5CD3] border-[#2B5CD3] text-white'
                    : 'bg-newColColor border-newBgLineColor'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'Hashtags' && (
        <AiHashtags />
      )}

      <div className="flex">
        <Button
          type="button"
          onClick={runAction}
          className="flex-1"
          disabled={loading}
        >
          {loading ? (
            <Loading height={16} width={16} type="spin" color="#fff" />
          ) : activeTab === 'Repurpose' ? (
            t('repurpose_content', 'Repurpose Content')
          ) : activeTab === 'Translate' ? (
            t('translate_content', 'Translate Content')
          ) : (
            t('generate_variants', 'Generate Variants')
          )}
        </Button>
      </div>

      {error && (
        <AiErrorDisplay error={error} onDismiss={() => setError(null)} />
      )}

      {results && (
        <div className="flex flex-col gap-[8px] max-h-[400px] overflow-y-auto">
          {activeTab === 'Repurpose' &&
            results.platforms &&
            results.platforms.map((p: any) => (
              <div
                key={p.platform}
                className="bg-newBgColorInner p-[12px] rounded-[8px] border border-newTableBorder"
              >
                <div className="flex justify-between items-center mb-[6px]">
                  <div className="text-[12px] font-[600] capitalize">
                    {p.platform}
                  </div>
                  <button
                    onClick={() => copyToClipboard(p.content)}
                    className="text-[11px] text-btnPrimaryAccent hover:underline"
                  >
                    {t('copy', 'Copy')}
                  </button>
                </div>
                <div className="text-[13px] leading-[20px] whitespace-pre-wrap">
                  {p.content}
                </div>
                {p.note && (
                  <div className="text-[11px] text-newTextColor/65 mt-[4px]">
                    {p.note}
                  </div>
                )}
              </div>
            ))}

          {activeTab === 'Translate' &&
            results.translations &&
            results.translations.map((tr: any) => (
              <div
                key={tr.locale}
                className="bg-newBgColorInner p-[12px] rounded-[8px] border border-newTableBorder"
              >
                <div className="flex justify-between items-center mb-[6px]">
                  <div className="text-[12px] font-[600] uppercase">
                    {tr.locale}
                  </div>
                  <button
                    onClick={() => copyToClipboard(tr.text)}
                    className="text-[11px] text-btnPrimaryAccent hover:underline"
                  >
                    {t('copy', 'Copy')}
                  </button>
                </div>
                <div className="text-[13px] leading-[20px] whitespace-pre-wrap">
                  {tr.text}
                </div>
              </div>
            ))}

          {activeTab === 'A/B Variants' &&
            results.variants &&
            results.variants.map((v: any) => (
              <div
                key={`${v.tone}-${(v.content || '').slice(0, 40)}`}
                className="bg-newBgColorInner p-[12px] rounded-[8px] border border-newTableBorder"
              >
                <div className="flex justify-between items-center mb-[6px]">
                  <div className="text-[12px] font-[600] capitalize">
                    {v.tone}
                  </div>
                  <button
                    onClick={() => copyToClipboard(v.content)}
                    className="text-[11px] text-btnPrimaryAccent hover:underline"
                  >
                    {t('copy', 'Copy')}
                  </button>
                </div>
                <div className="text-[13px] leading-[20px] whitespace-pre-wrap">
                  {v.content}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export const AiContentTools: FC = () => {
  const t = useT();
  const modals = useModals();

  const openModal = useCallback(() => {
    modals.openModal({
      title: t('ai_content_tools', 'AI Content Tools'),
      children: (close) => <ContentToolsModal close={close} />,
    });
  }, [modals, t]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openModal}
        aria-label={t('ai_content_tools', 'AI content tools')}
        className={clsx(
          'm-0 p-0 border-0 bg-transparent cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px]'
        )}
      >
        <div className="flex gap-[5px] items-center">
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M2 4.5H14M2 8H14M2 11.5H10"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <path
                d="M12 10L14 11.5L12 13"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="text-[10px] font-[600] iconBreak:hidden block">
            {t('content_tools', 'Content Tools')}
          </div>
        </div>
      </button>
    </div>
  );
};

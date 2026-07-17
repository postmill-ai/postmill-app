'use client';
import { Button } from '@gitroom/react/form/button';
import { FC, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import Loading from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 200; // ~10 minutes

type VideoJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export const isArtifactPath = (id: string) =>
  id.includes('/') || id.startsWith('http') || id.startsWith('data:');

const AiVideoModal: FC<{
  close: () => void;
  setLoading: (loading: boolean) => void;
  onChange: (params: { id: string; path: string }) => void;
}> = (props) => {
  const { close, setLoading, onChange } = props;
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const setLocked = useLaunchStore((p) => p.setLocked);
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('vertical');
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    return () => {
      setLocked(false);
      setLoading(false);
    };
  }, [setLocked, setLoading]);

  const pollJob = useCallback(
    async (jobId: string): Promise<{ id: string; path: string } | null> => {
      let polls = 0;
      while (polls < MAX_POLLS) {
        const res = await fetch(`/media/jobs/${jobId}`);
        if (!res.ok) {
          throw new Error(
            t('failed_to_check_video_status', 'Failed to check video status')
          );
        }
        const job = await res.json();
        if (job.status === 'completed') {
          if (!job.artifactUrl) {
            throw new Error(
              t(
                'video_completed_no_artifact',
                'Video completed but no artifact was returned'
              )
            );
          }
          return { id: job.id, path: job.artifactUrl };
        }
        if (job.status === 'failed') {
          throw new Error(
            job.error || t('video_generation_failed', 'Video generation failed')
          );
        }
        polls++;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      throw new Error(
        t('video_generation_timed_out', 'Video generation timed out')
      );
    },
    [fetch, t]
  );

  const generate = useCallback(async () => {
    if (!prompt.trim()) {
      toaster.show(
        t('please_type_your_prompt', 'Please type your prompt'),
        'warning'
      );
      return;
    }

    setLoading(true);
    setLocked(true);
    setPolling(true);
    close();

    try {
      const res = await fetch('/media/generate-video', {
        method: 'POST',
        body: JSON.stringify({ prompt, output }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toaster.show(
          err.error || t('failed_to_generate_video', 'Failed to generate video'),
          'warning'
        );
        return;
      }

      const { id } = await res.json();

      if (isArtifactPath(id)) {
        onChange({ id, path: id });
        return;
      }

      const result = await pollJob(id);
      if (result) {
        onChange(result);
      }
    } catch (e) {
      toaster.show(
        (e as Error).message ||
          t('failed_to_generate_video', 'Failed to generate video'),
        'warning'
      );
    } finally {
      setLocked(false);
      setLoading(false);
      setPolling(false);
    }
  }, [prompt, output, fetch, close, setLoading, setLocked, toaster, t, onChange, pollJob]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">{t('prompt', 'Prompt')}</div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'describe_the_video_you_want_to_generate',
            'Describe the video you want to generate...'
          )}
          className="bg-input min-h-[150px] p-[16px] outline-none border-newTableBorder border rounded-[4px] text-inputText placeholder-inputText"
        />
      </div>
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">{t('aspect_ratio', 'Aspect ratio')}</div>
        <div className="flex gap-[8px]">
          {[
            { key: 'vertical', label: t('vertical', 'Vertical') },
            { key: 'horizontal', label: t('horizontal', 'Horizontal') },
            { key: 'square', label: t('square', 'Square') },
          ].map((o) => (
            <Button
              key={o.key}
              type="button"
              onClick={() => setOutput(o.key)}
              secondary={output !== o.key}
              className="flex-1"
            >
              {o.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex">
        <Button
          type="button"
          onClick={generate}
          className="flex-1"
          loading={polling}
        >
          {t('generate', 'Generate')}
        </Button>
      </div>
    </div>
  );
};

export const AiVideo: FC<{
  value: string;
  onChange: (params: { id: string; path: string }) => void;
  disabled?: boolean;
}> = (props) => {
  const t = useT();
  const { onChange, disabled } = props;
  const [loading, setLoading] = useState(false);
  const modals = useModals();

  const openVideoModal = useCallback(() => {
    if (loading || disabled) {
      return;
    }
    modals.openModal({
      title: t('generate_ai_video', 'Generate AI Video'),
      children: (close) => (
        <AiVideoModal
          close={close}
          setLoading={setLoading}
          onChange={onChange}
        />
      ),
    });
  }, [loading, disabled, onChange, modals, t]);

  return (
    <div className="relative">
      <div
        onClick={openVideoModal}
        title={
          disabled
            ? t(
                'configure_video_provider',
                'Configure a video provider in Settings → Media'
              )
            : undefined
        }
        className={clsx(
          'h-[30px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px]',
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
        )}
      >
        {loading && (
          <div className="absolute start-[50%] -translate-x-[50%]">
            <Loading height={30} width={30} type="spin" color="#fff" />
          </div>
        )}
        <div
          className={clsx('flex gap-[5px] items-center', loading && 'invisible')}
        >
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <g clipPath="url(#clip0_2352_53058)">
                <path
                  d="M8.06916 14.1663V2.04134M4.97208 14.1663V11.1351M4.97208 5.07259V2.04134M11.1662 14.1663V11.1351M9.09973 2.02152L4.8482 2.04134C3.80748 2.04134 3.28712 2.04134 2.88962 2.23957C2.53997 2.41394 2.25569 2.69218 2.07754 3.0344C1.875 3.42345 1.875 3.93275 1.875 4.95134L1.875 11.2563C1.875 12.2749 1.875 12.7842 2.07754 13.1733C2.25569 13.5155 2.53997 13.7937 2.88962 13.9681C3.28712 14.1663 3.80748 14.1663 4.8482 14.1663H11.2901C12.3308 14.1663 12.8512 14.1663 13.2487 13.9681C13.5984 13.7937 13.8826 13.5155 14.0608 13.1733C14.2633 12.7842 14.2633 12.2749 14.2633 11.2563V7.61426M1.875 5.07259L9.09973 5.06116M1.875 11.1351H14.2633M12.8141 1.20801L12.3949 2.02152C12.253 2.29684 12.1821 2.4345 12.0873 2.55379C12.0032 2.65965 11.9054 2.75455 11.7963 2.83614C11.6734 2.92809 11.5315 2.99692 11.2478 3.13458L10.4094 3.54134L11.2478 3.9481C11.5315 4.08576 11.6734 4.15459 11.7963 4.24654C11.9054 4.32814 12.0032 4.42303 12.0873 4.52889C12.1821 4.64818 12.253 4.78584 12.3949 5.06116L12.8141 5.87467L13.2333 5.06116C13.3751 4.78584 13.4461 4.64818 13.5408 4.52889C13.6249 4.42303 13.7227 4.32814 13.8318 4.24654C13.9548 4.15459 14.0966 4.08576 14.3804 3.9481L15.2188 3.54134L14.3804 3.13458C14.0966 2.99692 13.9548 2.92809 13.8318 2.83614C13.7227 2.75455 13.6249 2.65965 13.5408 2.55379C13.4461 2.4345 13.3751 2.29684 13.2333 2.02152L12.8141 1.20801Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              <defs>
                <clipPath id="clip0_2352_53058">
                  <rect width="16" height="16" fill="currentColor" />
                </clipPath>
              </defs>
            </svg>
          </div>
          <div className="text-[10px] font-[600] iconBreak:hidden block">
            {t('ai_video_label', 'AI Video')}
          </div>
        </div>
      </div>
    </div>
  );
};

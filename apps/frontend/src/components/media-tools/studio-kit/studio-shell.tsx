'use client';

import React, { useMemo, useState } from 'react';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { FullscreenButton } from '@gitroom/frontend/components/media-tools/fullscreen-button';
import { useFullscreen } from '@gitroom/frontend/components/media-tools/use-fullscreen';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { StudioForm } from './studio-form';
import { StudioLanding } from './studio-landing';
import { RenderQueue } from './render-queue';
import { useStudioStatus, useStudioJobs, useStudioGenerate } from './hooks';
import { studioNs, studioTabKey, studioTabDescKey } from './i18n-keys';
import type {
  FileFieldValue,
  StudioDescriptor,
  StudioFieldValue,
  StudioGenerateBody,
  StudioTab,
} from './types';

function defaultsFor(tab: StudioTab): Record<string, StudioFieldValue> {
  const out: Record<string, StudioFieldValue> = {};
  for (const f of tab.fields) {
    if (f.type === 'select') {
      if (f.default !== undefined) out[f.name] = f.default;
      // A plain <select> visually shows its first option even when nothing is
      // picked — seed it so the displayed value is actually submitted. Dynamic
      // model comboboxes (source:'models') render an empty search box, so skip.
      else if (f.source !== 'models' && f.options?.length) out[f.name] = f.options[0].value;
    } else if (f.type === 'number') {
      if (f.default !== undefined) out[f.name] = f.default;
      // A range slider always shows a thumb (min when unset) — seed min so it's
      // submitted; a plain number input renders empty, so only seed when ranged.
      else if (f.min !== undefined && f.max !== undefined) out[f.name] = f.min;
    } else if (f.type === 'toggle' && f.default !== undefined) {
      out[f.name] = f.default;
    }
  }
  return out;
}

function isFilled(value: StudioFieldValue): boolean {
  if (value === undefined || value === '') return false;
  if (typeof value === 'object') return !!(value.fileId || value.url);
  return true;
}

function buildBody(tab: StudioTab, values: Record<string, StudioFieldValue>): StudioGenerateBody {
  const input: Record<string, string | number | boolean> = {};
  const mediaInputs: Record<string, string> = {};
  for (const f of tab.fields) {
    const v = values[f.name];
    if (f.type === 'media') {
      const fv = v as FileFieldValue | undefined;
      if (fv?.fileId) mediaInputs[f.name] = fv.fileId;
      else if (fv?.url) input[f.name] = fv.url;
    } else if (v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v))) {
      input[f.name] = v as string | number | boolean;
    }
  }
  const model = tab.model || (typeof values['model'] === 'string' ? (values['model'] as string) : undefined);
  return {
    operation: tab.operation,
    model,
    input,
    mediaInputs: Object.keys(mediaInputs).length ? mediaInputs : undefined,
  };
}

export function StudioShell({ descriptor }: { descriptor: StudioDescriptor }) {
  const { provider, title, tabs } = descriptor;
  const toaster = useToaster();
  // `t` is the tabs.map loop var below — bind the hook as `translate` (§3.5).
  const translate = useT();
  const keyNs = studioNs(provider, title);
  const { data: status } = useStudioStatus(provider);
  const configured = !!status?.configured;

  const [tabKey, setTabKey] = useState(tabs[0]?.key);
  const tab = tabs.find((t) => t.key === tabKey) ?? tabs[0];

  const [valuesByTab, setValuesByTab] = useState<Record<string, Record<string, StudioFieldValue>>>({});
  const values = valuesByTab[tab.key] ?? defaultsFor(tab);
  const setValue = (name: string, value: StudioFieldValue) =>
    setValuesByTab((prev) => ({
      ...prev,
      [tab.key]: { ...(prev[tab.key] ?? defaultsFor(tab)), [name]: value },
    }));

  const generate = useStudioGenerate(provider);
  const { data: jobs, isLoading: jobsLoading, mutate: mutateJobs } = useStudioJobs(provider, configured);
  const { isFullscreen } = useFullscreen();
  const [generating, setGenerating] = useState(false);

  const canGenerate = useMemo(
    () => tab.fields.filter((f) => f.required).every((f) => isFilled(values[f.name])),
    [tab, values]
  );

  const onGenerate = async () => {
    setGenerating(true);
    try {
      await generate(buildBody(tab, values));
      toaster.show(translate('studio_render_started', 'Render started'), 'success');
      mutateJobs();
    } catch (err) {
      toaster.show(
        (err as Error).message || translate('studio_render_start_failed', 'Failed to start the render'),
        'warning'
      );
    } finally {
      setGenerating(false);
    }
  };

  if (!status) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2B5CD3]" />
      </div>
    );
  }

  if (!configured) {
    if (descriptor.landing) {
      return <StudioLanding identifier={provider} title={title} landing={descriptor.landing} />;
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-[14px] text-center px-[20px]">
        <div className="text-[42px]">🎬</div>
        <h2 className="text-[18px] font-[600] text-textColor">
          {translate('studio_not_configured_title', "{{title}} isn't configured", { title })}
        </h2>
        <p className="text-[13px] text-newTextColor/65 max-w-[360px]">
          {translate(
            'studio_not_configured_body',
            'Add your {{title}} credentials to start generating, then come back here.',
            { title }
          )}
        </p>
        <a
          href="/settings/content/ai-media"
          className="mt-[4px] px-[16px] py-[9px] rounded-[8px] bg-[#2B5CD3] text-white text-[13px] font-[500] hover:bg-[#2B5CD3]/80 transition-all"
        >
          {translate('studio_configure_provider', 'Configure {{title}}', { title })}
        </a>
      </div>
    );
  }

  const Custom = tab.custom;

  return (
    <div className={`flex flex-col h-full bg-studioBg${isFullscreen ? ' fixed inset-0 z-[100]' : ' rounded-[12px] overflow-hidden'}`}>
      <div className="flex items-center justify-between gap-[10px] px-[16px] h-[52px] border-b border-studioBorder shrink-0">
        <div className="flex items-center gap-[10px] shrink-0">
          <Logo size={22} className="" />
          <h1 className="text-[15px] font-[600] text-textColor whitespace-nowrap">{title}</h1>
        </div>
        <div className="flex items-center gap-[8px] min-w-0">
          <div className="flex items-center gap-[4px] overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTabKey(t.key)}
                className={`px-[12px] h-[34px] rounded-[8px] text-[13px] whitespace-nowrap border transition-all ${
                  tab.key === t.key
                    ? 'bg-[#2B5CD3]/20 text-textColor border-transparent'
                    : 'border-studioBorder text-newTextColor/70 hover:bg-boxHover hover:text-textColor hover:border-[#2B5CD3]'
                }`}
              >
                {translate(studioTabKey(keyNs, t.key), t.label)}
              </button>
            ))}
          </div>
          <FullscreenButton />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 mobile:flex-col">
        <div className="flex-1 min-w-0 overflow-y-auto p-[20px]">
          {Custom ? (
            <Custom provider={provider} onGenerated={() => mutateJobs()} />
          ) : (
            <div className="max-w-[640px] mx-auto flex flex-col gap-[18px]">
              {tab.description && (
                <p className="text-[13px] text-newTextColor/70">
                  {translate(studioTabDescKey(keyNs, tab.key), tab.description)}
                </p>
              )}
              <StudioForm
                fields={tab.fields}
                values={values}
                onChange={setValue}
                provider={provider}
                operation={tab.operation}
                keyNs={keyNs}
                tabKey={tab.key}
              />
              <button
                type="button"
                onClick={onGenerate}
                disabled={!canGenerate || generating}
                className="self-start px-[20px] py-[10px] rounded-[8px] bg-[#2B5CD3] text-white text-[13px] font-[600] hover:bg-[#2B5CD3]/80 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? translate('starting_ellipsis', 'Starting…') : translate('generate', 'Generate')}
              </button>
            </div>
          )}
        </div>

        <div className="w-[320px] mobile:w-full shrink-0 border-l mobile:border-l-0 mobile:border-t border-studioBorder flex flex-col min-h-0">
          <div className="flex items-center justify-between px-[14px] h-[44px] border-b border-studioBorder shrink-0">
            <span className="text-[12px] font-[600] uppercase tracking-wider text-newTableText">
              {translate('studio_render_queue', 'Render queue')}
            </span>
            <button
              type="button"
              onClick={() => mutateJobs()}
              aria-label={translate('studio_refresh_queue', 'Refresh queue')}
              className="w-[26px] h-[26px] flex items-center justify-center rounded-[6px] text-newTextColor/65 hover:text-textColor hover:bg-boxHover transition-all"
            >
              ⟳
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-[12px]">
            <RenderQueue jobs={jobs} isLoading={jobsLoading} />
          </div>
        </div>
      </div>
    </div>
  );
}

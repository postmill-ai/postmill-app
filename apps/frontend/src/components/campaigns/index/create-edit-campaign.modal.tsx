'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import dayjs from 'dayjs';
import type { Campaign } from '@gitroom/frontend/components/campaigns/campaign-types';
import { TagsInput } from '@gitroom/frontend/components/campaigns/index/tags-input';
import { ColorPicker } from '@gitroom/frontend/components/ui/color-picker';

const GOAL_METRICS = ['impressions', 'likes', 'comments', 'clicks', 'posts', 'followers'] as const;

export interface CreateEditCampaignModalProps {
  editing?: Campaign | null;
  onDone: () => void;
}

export const CreateEditCampaignModal: FC<CreateEditCampaignModalProps> = ({ editing, onDone }) => {
  const fetch = useFetch();
  const toast = useToaster();
  const t = useT();
  const [name, setName] = useState(editing?.name || '');
  const [color, setColor] = useState(editing?.color || '');
  const [description, setDescription] = useState(editing?.description || '');
  const [startDate, setStartDate] = useState(editing?.startDate ? dayjs(editing.startDate).format('YYYY-MM-DD') : '');
  const [endDate, setEndDate] = useState(editing?.endDate ? dayjs(editing.endDate).format('YYYY-MM-DD') : '');
  const [utmEnabled, setUtmEnabled] = useState(editing?.utmEnabled ?? false);
  const [client, setClient] = useState(editing?.client || '');
  const [project, setProject] = useState(editing?.project || '');
  const [tags, setTags] = useState<string[]>(editing?.tags || []);
  const [goals, setGoals] = useState<Array<{ metric: string; target: string }>>(
    (editing?.goals || []).map((g) => ({ metric: g.metric, target: String(g.target) }))
  );
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const addGoal = useCallback(() => {
    setGoals((prev) => [...prev, { metric: GOAL_METRICS[0], target: '' }]);
  }, []);

  const removeGoal = useCallback((idx: number) => {
    setGoals((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateGoal = useCallback((idx: number, patch: Partial<{ metric: string; target: string }>) => {
    setGoals((prev) => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }, []);

  const save = useCallback(async () => {
    if (!name.trim()) return;

    const payload = {
      name: name.trim(),
      color: color || undefined,
      description: description.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      utmEnabled,
      // Sent unconditionally (not `|| undefined`) so emptying a field on edit
      // actually clears it — the backend update omits only undefined fields.
      client: client.trim(),
      project: project.trim(),
      tags,
      goals: goals.length
        ? goals
            .filter((g) => g.target && !Number.isNaN(Number(g.target)))
            .map((g) => ({ metric: g.metric, target: Number(g.target) }))
        : undefined,
    };

    const url = editing ? `/campaigns/${editing.id}` : '/campaigns';
    const method = editing ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      toast.show(t('campaign_save_failed', 'Failed to save campaign'), 'warning');
      return;
    }

    toast.show(
      editing ? t('campaign_updated', 'Campaign updated') : t('campaign_created', 'Campaign created'),
      'success'
    );
    onDone();
  }, [name, color, description, startDate, endDate, utmEnabled, client, project, tags, goals, editing, fetch, toast, t, onDone]);

  return (
    <div className="flex flex-col gap-[16px] p-[16px] min-w-[400px]">
      <div className="flex flex-col gap-[4px]">
        <label className="text-[12px] text-newTableText">{t('name', 'Name')}</label>
        <input
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          placeholder={t('campaign_name_placeholder', 'Campaign name')}
        />
      </div>
      <ColorPicker
        value={color || null}
        onChange={(c) => setColor(c || '')}
      />
      <div className="flex flex-col gap-[4px]">
        <label className="text-[12px] text-newTableText">{t('description', 'Description')}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none resize-none min-h-[60px]"
          placeholder={t('campaign_desc_placeholder', 'Optional description')}
        />
      </div>
      <div className="flex gap-[8px]">
        <div className="flex flex-col gap-[4px] flex-1">
          <label className="text-[12px] text-newTableText">{t('client', 'Client')}</label>
          <input
            type="text"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
            placeholder={t('campaign_client_placeholder', 'Which client is this for?')}
          />
        </div>
        <div className="flex flex-col gap-[4px] flex-1">
          <label className="text-[12px] text-newTableText">{t('project', 'Project')}</label>
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
            placeholder={t('campaign_project_placeholder', 'Which project?')}
          />
        </div>
      </div>
      <div className="flex flex-col gap-[4px]">
        <label className="text-[12px] text-newTableText">{t('tags', 'Tags')}</label>
        <TagsInput
          value={tags}
          onChange={setTags}
          placeholder={t('campaign_tags_placeholder', 'tag1, tag2, tag3')}
        />
      </div>
      <div className="flex gap-[8px]">
        <div className="flex flex-col gap-[4px] flex-1">
          <label className="text-[12px] text-newTableText">{t('start_date', 'Start Date')}</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none w-full"
          />
        </div>
        <div className="flex flex-col gap-[4px] flex-1">
          <label className="text-[12px] text-newTableText">{t('end_date', 'End Date')}</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none w-full"
          />
        </div>
      </div>

      <div className="flex items-center gap-[12px] p-[12px] rounded-[8px] bg-newBgColor border border-newTableBorder">
        <input
          id="utmEnabled"
          type="checkbox"
          checked={utmEnabled}
          onChange={(e) => setUtmEnabled(e.target.checked)}
          className="w-[16px] h-[16px] accent-btnPrimary"
        />
        <label htmlFor="utmEnabled" className="flex flex-col cursor-pointer">
          <span className="text-[13px] text-textColor font-medium">{t('utm_enabled', 'Auto-append UTM tags')}</span>
          <span className="text-[11px] text-newTableText">
            {t('utm_enabled_hint', 'Add utm_campaign, utm_source and utm_medium to links in campaign posts')}
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-[12px]">
        <div className="flex items-center justify-between">
          <label className="text-[12px] text-newTableText">{t('goals', 'Goals & Targets')}</label>
          <button
            type="button"
            onClick={addGoal}
            className="text-[12px] text-btnPrimaryAccent hover:underline"
          >
            {t('add_goal', 'Add goal')}
          </button>
        </div>
        {goals.length === 0 && (
          <p className="text-[12px] text-newTableText">{t('no_goals', 'No goals set yet.')}</p>
        )}
        {goals.map((goal, idx) => (
          <div key={`${goal.metric}-${goal.target}-${idx}`} className="flex gap-[8px] items-center">
            <select
              value={goal.metric}
              onChange={(e) => updateGoal(idx, { metric: e.target.value })}
              className="px-[10px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[13px] outline-none capitalize"
            >
              {GOAL_METRICS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={goal.target}
              onChange={(e) => updateGoal(idx, { target: e.target.value })}
              placeholder={t('target', 'Target')}
              className="flex-1 px-[10px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[13px] outline-none"
            />
            <button
              type="button"
              onClick={() => removeGoal(idx)}
              className="text-[12px] text-dangerText hover:text-red-300 px-[6px]"
            >
              {t('remove', 'Remove')}
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-[8px] justify-end mt-[8px]">
        <Button type="button" secondary onClick={onDone}>{t('cancel', 'Cancel')}</Button>
        <Button type="button" onClick={save} disabled={!name.trim()}>
          {editing ? t('update', 'Update') : t('create', 'Create')}
        </Button>
      </div>
    </div>
  );
};

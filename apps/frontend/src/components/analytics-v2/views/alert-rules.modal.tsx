'use client';

import { FC, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import {
  useAlertRules,
  AlertRule,
  AlertRuleInput,
  AlertComparator,
  AlertDirection,
} from '../hooks/useAlertRules';
import { CANONICAL_METRICS } from '../utils';
import { TabSkeleton, ErrorState } from '../kit/states';

const SELECT_CLS =
  'px-[10px] py-[7px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60';

const COMPARATORS: { value: AlertComparator; labelKey: string; fallback: string }[] = [
  { value: 'gte', labelKey: 'alert_cmp_gte', fallback: 'is at or above' },
  { value: 'lte', labelKey: 'alert_cmp_lte', fallback: 'is at or below' },
  { value: 'change_pct', labelKey: 'alert_cmp_change', fallback: 'changes % week-over-week' },
];

function emptyRule(): AlertRuleInput {
  return {
    integrationId: null,
    metric: 'followers',
    comparator: 'gte',
    threshold: 1000,
    direction: 'up',
    enabled: true,
  };
}

export const AlertRulesModal: FC = () => {
  const t = useT();
  const toaster = useToaster();
  const { data: rules, isLoading, error, mutate, create, update, remove } = useAlertRules();
  const { data: integrationsData } = useIntegrationList();
  const integrations = useMemo(
    () => (integrationsData || []) as Integrations[],
    [integrationsData]
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AlertRuleInput>(emptyRule());
  const [saving, setSaving] = useState(false);

  const channelName = (id: string | null) => {
    if (!id) return t('alert_any_channel', 'Any channel');
    return integrations.find((i) => i.id === id)?.name || id;
  };
  const metricLabel = (metric: string) => {
    const found = CANONICAL_METRICS.find((m) => m.key === metric);
    return found ? t(found.labelKey, found.label) : metric;
  };

  const startEdit = (rule: AlertRule) => {
    setEditingId(rule.id);
    setForm({
      integrationId: rule.integrationId,
      metric: rule.metric,
      comparator: rule.comparator,
      threshold: rule.threshold,
      direction: rule.direction,
      enabled: rule.enabled,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyRule());
  };

  const submit = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await update(editingId, form);
        toaster.show(t('alert_rule_saved', 'Alert rule saved'), 'success');
      } else {
        await create(form);
        toaster.show(t('alert_rule_created', 'Alert rule created'), 'success');
      }
      resetForm();
    } catch {
      toaster.show(t('alert_rule_save_failed', 'Failed to save alert rule'), 'warning');
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    try {
      await remove(id);
      if (editingId === id) resetForm();
      toaster.show(t('alert_rule_deleted', 'Alert rule deleted'), 'success');
    } catch {
      toaster.show(t('alert_rule_delete_failed', 'Failed to delete alert rule'), 'warning');
    }
  };

  const toggle = async (rule: AlertRule) => {
    try {
      await update(rule.id, { enabled: !rule.enabled });
    } catch {
      toaster.show(t('alert_rule_save_failed', 'Failed to save alert rule'), 'warning');
    }
  };

  return (
    <div className="w-full sm:w-[560px] max-w-full flex flex-col gap-[16px]">
      {/* Existing rules */}
      {isLoading ? (
        <TabSkeleton variant="list" />
      ) : error ? (
        <ErrorState
          title={t('alert_rules_load_failed', 'Failed to load alert rules')}
          onRetry={() => mutate()}
        />
      ) : (rules || []).length === 0 ? (
        <p className="text-[13px] text-newTableText">
          {t('alert_rules_empty', 'No alert rules yet. Create one below.')}
        </p>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {(rules || []).map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-[8px] flex-wrap p-[12px] bg-newBgColorInner border border-newTableBorder rounded-[10px]"
            >
              <div className="min-w-0 text-[13px]">
                <div className="font-medium text-textColor truncate">
                  {channelName(rule.integrationId)} · {metricLabel(rule.metric)}
                </div>
                <div className="text-[12px] text-newTableText">
                  {(() => {
                    const c = COMPARATORS.find((c) => c.value === rule.comparator);
                    return c ? t(c.labelKey, c.fallback) : rule.comparator;
                  })()}{' '}
                  {rule.threshold}
                  {rule.comparator === 'change_pct' ? '%' : ''} ·{' '}
                  {rule.direction === 'up'
                    ? t('alert_dir_up', 'increase')
                    : t('alert_dir_down', 'decrease')}
                </div>
              </div>
              <div className="flex items-center gap-[6px]">
                <button
                  type="button"
                  onClick={() => toggle(rule)}
                  className={`px-[8px] py-[4px] text-[12px] rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60 ${
                    rule.enabled
                      ? 'bg-[var(--positive,#32d583)] text-white'
                      : 'bg-newTableHeader text-newTableText'
                  }`}
                >
                  {rule.enabled ? t('enabled', 'Enabled') : t('disabled', 'Disabled')}
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(rule)}
                  className="px-[8px] py-[4px] text-[12px] rounded-[6px] bg-newTableHeader text-newTableText hover:text-textColor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
                >
                  {t('edit', 'Edit')}
                </button>
                <button
                  type="button"
                  onClick={() => del(rule.id)}
                  aria-label={t('alert_rule_delete', 'Delete rule')}
                  className="px-[8px] py-[4px] text-[12px] rounded-[6px] text-amber-600 hover:bg-newTableHeader focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
                >
                  {t('delete', 'Delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit form */}
      <div className="border-t border-newTableBorder pt-[16px] flex flex-col gap-[12px]">
        <h4 className="text-[13px] font-semibold text-textColor">
          {editingId
            ? t('alert_rule_edit_title', 'Edit rule')
            : t('alert_rule_new_title', 'New rule')}
        </h4>
        <div className="grid grid-cols-2 gap-[10px]">
          <label className="flex flex-col gap-[4px]">
            <span className="text-[12px] text-newTableText">
              {t('alert_channel', 'Channel')}
            </span>
            <select
              value={form.integrationId ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, integrationId: e.target.value || null }))
              }
              className={SELECT_CLS}
            >
              <option value="">{t('alert_any_channel', 'Any channel')}</option>
              {integrations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[12px] text-newTableText">{t('metric', 'Metric')}</span>
            <select
              value={form.metric}
              onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
              className={SELECT_CLS}
            >
              {CANONICAL_METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {t(m.labelKey, m.label)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[12px] text-newTableText">
              {t('alert_comparator', 'Condition')}
            </span>
            <select
              value={form.comparator}
              onChange={(e) =>
                setForm((f) => ({ ...f, comparator: e.target.value as AlertComparator }))
              }
              className={SELECT_CLS}
            >
              {COMPARATORS.map((c) => (
                <option key={c.value} value={c.value}>
                  {t(c.labelKey, c.fallback)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[12px] text-newTableText">
              {t('alert_threshold', 'Threshold')}
            </span>
            <input
              type="number"
              value={form.threshold}
              onChange={(e) =>
                setForm((f) => ({ ...f, threshold: Number(e.target.value) }))
              }
              className={SELECT_CLS}
            />
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[12px] text-newTableText">
              {t('alert_direction', 'Direction')}
            </span>
            <select
              value={form.direction}
              onChange={(e) =>
                setForm((f) => ({ ...f, direction: e.target.value as AlertDirection }))
              }
              className={SELECT_CLS}
            >
              <option value="up">{t('alert_dir_up', 'increase')}</option>
              <option value="down">{t('alert_dir_down', 'decrease')}</option>
            </select>
          </label>
          <label className="flex items-end gap-[8px] pb-[6px]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="w-[16px] h-[16px] accent-btnPrimary"
            />
            <span className="text-[13px] text-newTableText">
              {t('alert_enabled', 'Enabled')}
            </span>
          </label>
        </div>
        <div className="flex items-center gap-[8px]">
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[13px] font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
          >
            {editingId ? t('save', 'Save') : t('add', 'Add')}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="px-[16px] py-[8px] bg-newTableHeader text-newTableText rounded-[8px] text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-designerAccent/60"
            >
              {t('cancel', 'Cancel')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

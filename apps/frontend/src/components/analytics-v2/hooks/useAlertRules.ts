'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCallback } from 'react';
import useSWR from 'swr';
import { createFetchError } from '../utils';

export type AlertComparator = 'gte' | 'lte' | 'change_pct';
export type AlertDirection = 'up' | 'down';

// A user-defined alert rule (7.3). `integrationId: null` = any channel.
export interface AlertRule {
  id: string;
  integrationId: string | null;
  metric: string;
  comparator: AlertComparator;
  threshold: number;
  direction: AlertDirection;
  enabled: boolean;
  lastFiredAt: string | null;
}

// Payload for create/update (id/lastFiredAt are server-owned).
export type AlertRuleInput = Omit<AlertRule, 'id' | 'lastFiredAt'>;

/**
 * User-defined alert rules CRUD (7.3). One SWR resource
 * (`GET /analytics/v2/alert-rules`) plus create/update/remove mutations that
 * revalidate it. Rule-fired anomalies come back through `useAnomalies` (rows
 * with `ruleId` set) — the Alerts list badges those separately.
 */
export const useAlertRules = () => {
  const fetch = useFetch();
  const key = '/analytics/v2/alert-rules';

  const load = useCallback(
    async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) throw createFetchError('alert_rules_fetch_failed', 'Failed to load alert rules');
      return res.json() as Promise<AlertRule[]>;
    },
    [fetch]
  );

  const swr = useSWR<AlertRule[]>(key, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const { mutate } = swr;

  const create = useCallback(
    async (input: AlertRuleInput) => {
      const res = await fetch(key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw createFetchError('alert_rule_create_failed', 'Failed to create alert rule');
      await mutate();
    },
    [fetch, mutate]
  );

  const update = useCallback(
    async (id: string, input: Partial<AlertRuleInput>) => {
      const res = await fetch(`${key}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw createFetchError('alert_rule_update_failed', 'Failed to update alert rule');
      await mutate();
    },
    [fetch, mutate]
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`${key}/${id}`, { method: 'DELETE' });
      if (!res.ok) throw createFetchError('alert_rule_delete_failed', 'Failed to delete alert rule');
      await mutate();
    },
    [fetch, mutate]
  );

  return { ...swr, create, update, remove };
};

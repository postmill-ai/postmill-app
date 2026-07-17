'use client';

import React, { FC, useEffect, useState } from 'react';
import { useCopilotReadable } from '@copilotkit/react-core';

/**
 * Compact UI context exposed to the agent when the user is chatting from
 * `/agents`. Surfaces such as `/launches`, `/campaigns`, or the post detail
 * modal can call `setAgentUiContext()` to push ids/labels; the bridge forwards
 * them to CopilotKit as a readable so the backend instructions can include a
 * "Current view" preamble.
 *
 * Payloads are intentionally tiny (ids + labels, never full post bodies).
 */
export interface AgentUiContextValue {
  /** Semantic name of the surface that pushed context, e.g. "launches". */
  view?: string;
  /** ISO calendar week or selected range, e.g. "2026-06-01/2026-06-07". */
  calendarWeek?: string;
  /** Post ids currently visible in the calendar/list view. */
  visiblePostIds?: string[];
  /** Selected campaign id, if any. */
  selectedCampaignId?: string;
  /** Selected customer/group id, if any. */
  currentCustomerId?: string;
  /** Alias for currentCustomerId kept for compatibility with legacy naming. */
  currentGroupId?: string;
  /** Post id when a post detail modal is open. */
  currentPostId?: string;
  /**
   * ISO timestamp set when the last producer for this snapshot unmounted (2.3).
   * Present => the user has navigated away, so these ids are a *last-viewed*
   * snapshot (possibly stale), not the live view. Cleared when a fresh producer
   * mounts.
   */
  leftViewAt?: string;
}

let currentAgentUiContext: AgentUiContextValue = {};
const listeners = new Set<() => void>();

export function getAgentUiContext(): AgentUiContextValue {
  return currentAgentUiContext;
}

export function setAgentUiContext(
  ctx:
    | AgentUiContextValue
    | ((prev: AgentUiContextValue) => AgentUiContextValue)
) {
  currentAgentUiContext =
    typeof ctx === 'function'
      ? ctx(currentAgentUiContext)
      : ctx;
  listeners.forEach((l) => l());
}

export function subscribeAgentUiContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Scoped producer helper with last-view semantics (2.3). The producers
 * (`/launches`, `/campaigns`, post-detail modal) never co-mount with the
 * `AgentContextBridge` (which lives only under `/agents`), so a disposer that
 * *deleted* its keys would always leave the store empty by the time the user
 * reaches the chat — the feature would be inert. Instead:
 *  - On mount: merge `partial` and clear `leftViewAt` for the whole store, so a
 *    freshly-mounted view wins over a previous last-view snapshot. Sibling merge
 *    semantics are preserved (the modal contributes `currentPostId` on top of
 *    launches' keys).
 *  - On unmount: KEEP the contributed keys and stamp `leftViewAt` so the backend
 *    preamble can word it as "most recently viewed (may be stale)".
 * Wire it from an effect: `useEffect(() => pushAgentUiContext({...}), […])`.
 */
export function pushAgentUiContext(partial: AgentUiContextValue): () => void {
  setAgentUiContext((prev) => {
    // A fresh view is live now: drop any stale marker from a prior snapshot.
    const next = { ...prev, ...partial };
    delete next.leftViewAt;
    return next;
  });
  return () => {
    setAgentUiContext((prev) => ({
      ...prev,
      leftViewAt: new Date().toISOString(),
    }));
  };
}

/**
 * Renders nothing. Registers the current UI view with CopilotKit so the
 * backend instructions can mention what the user was looking at.
 */
export const AgentContextBridge: FC = () => {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    return subscribeAgentUiContext(() => forceUpdate({}));
  }, []);

  useCopilotReadable({
    description: 'Current UI view context for the agent',
    value: currentAgentUiContext,
  });

  return null;
};

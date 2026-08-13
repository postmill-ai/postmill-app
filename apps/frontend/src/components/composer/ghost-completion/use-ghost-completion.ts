'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVariables } from '@postmill-ai/react/helpers/variable.context';
import { csrfHeader } from '@postmill-ai/helpers/utils/csrf.header';
import { useLaunchStore } from '@postmill-ai/frontend/components/composer/store';
import { useAiActive } from '@postmill-ai/frontend/components/layout/use-ai-active';
import {
  GhostCompletionPluginKey,
  caretAtEndOfBlock,
  getGhostState,
} from './ghost-completion.extension';
import {
  shouldRequestSuggestion,
  normalizeSuggestion,
  withJoiningSpace,
  SUGGEST_DEBOUNCE_MS,
  MAX_PREFIX_CHARS,
} from './should-suggest';
import { useInlineSuggestPref } from './use-inline-suggest-pref';

/**
 * Owns the debounce and the network request for inline ghost-text completion.
 *
 * This lives in React rather than in the extension's options for a concrete
 * reason: `useEditor` in `editor.tsx` is called with **no dependency array**, so
 * anything captured by an extension option is frozen at first render — the
 * selected brand and channel would never update. It also needs `useVariables`,
 * `useLaunchStore` and `useAiActive`, none of which exist inside a ProseMirror
 * plugin. Keeping the extension free of them leaves it testable against a
 * headless editor with no mocks.
 *
 * Everything here is a ref, never state: the editor runs with
 * `shouldRerenderOnTransaction: true`, so a state write per keystroke would
 * re-render the media grid and toolbar on every character typed.
 */
export const useGhostCompletion = (editor: any) => {
  const { backendUrl } = useVariables();
  const aiActive = useAiActive();
  const { enabled } = useInlineSuggestPref();

  const { brandId, current, locked, isCreateSet, internal } = useLaunchStore(
    useShallow((state) => ({
      brandId: state.brandId,
      current: state.current,
      locked: state.locked,
      isCreateSet: state.isCreateSet,
      internal: state.internal.find((p) => p.integration.id === state.current),
    }))
  );

  // The transaction handler is registered once, so it reads live values from
  // here rather than from a closure that would freeze at first render.
  const snapshot = {
    backendUrl,
    aiActive,
    enabled,
    brandId,
    locked,
    isCreateSet,
    identifier: internal?.integration?.identifier as string | undefined,
    // The composer's "click to edit this channel" overlay, not `editable`.
    canEdit: current === 'global' || !!internal,
  };
  const latest = useRef(snapshot);
  // Written in an effect, not during render: refs are not render-time values.
  useEffect(() => {
    latest.current = snapshot;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const requestCountRef = useRef(0);
  // prefix -> suggestion, so re-typing over the same ground is free.
  const cacheRef = useRef(new Map<string, string>());

  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const request = useCallback(
    async (prefix: string, cacheKey: string): Promise<string> => {
      const cached = cacheRef.current.get(cacheKey);
      if (cached !== undefined) return cached;

      const controller = new AbortController();
      abortRef.current = controller;
      requestCountRef.current += 1;

      // Deliberately NOT `useFetch`: its afterRequest turns a 429 into a toast,
      // a 402/406 into a modal and a 401 into a logout redirect — none of which
      // may happen because someone paused mid-sentence. It also replaces the
      // caller's options wholesale, which would drop the abort signal.
      const res = await window.fetch(`${latest.current.backendUrl}/ai/suggest`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfHeader() || {}),
        },
        // Exactly these keys: the API's validation pipe is whitelist +
        // forbidNonWhitelisted, so an extra field 400s the request.
        body: JSON.stringify({
          prefix,
          platform: latest.current.identifier,
          brandId: latest.current.brandId ?? undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) return '';
      const data = await res.json();
      const suggestion = typeof data?.suggestion === 'string' ? data.suggestion : '';

      if (cacheRef.current.size > 50) cacheRef.current.clear();
      cacheRef.current.set(cacheKey, suggestion);
      return suggestion;
    },
    []
  );

  useEffect(() => {
    if (!editor) return undefined;

    const onTransaction = ({ transaction }: { transaction?: any } = {}) => {
      // Our own show/hide transactions must not re-enter this handler: setting a
      // suggestion dispatches a transaction, which would land here and
      // immediately clear the ghost it just set. They are also not user
      // activity, so they must not re-arm the debounce.
      if (transaction?.getMeta?.(GhostCompletionPluginKey)) return;

      cancelPending();

      // Only dispatch when something is actually showing: every transaction
      // re-renders the editor subtree.
      if (getGhostState(editor.state).text) {
        editor.commands.clearGhostSuggestion();
      }

      const ctx = latest.current;
      const { selection } = editor.state;
      const textBefore = editor.state.doc.textBetween(0, selection.head, '\n', ' ');

      const ok = shouldRequestSuggestion({
        enabled: ctx.enabled,
        aiActive: ctx.aiActive,
        locked: ctx.locked,
        isCreateSet: ctx.isCreateSet,
        canEdit: ctx.canEdit,
        isEditable: editor.isEditable,
        isFocused: editor.isFocused,
        selectionEmpty: selection.empty,
        caretAtEndOfBlock: caretAtEndOfBlock(editor.state),
        textBefore,
        composing: !!editor.view?.composing,
        suppressed: getGhostState(editor.state).suppressed,
        requestCount: requestCountRef.current,
      });
      if (!ok) return;

      const id = ++requestIdRef.current;
      const anchor = selection.head;
      const docSize = editor.state.doc.content.size;
      const cacheKey = `${textBefore.slice(-400)}|${ctx.identifier ?? ''}|${
        ctx.brandId ?? ''
      }`;

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Slice to the DTO's @MaxLength(4000): the server only reads the tail,
        // and an over-cap prefix 400s under forbidNonWhitelisted. The cache key
        // already keys on the tail, so this changes nothing but the wire size.
        request(textBefore.slice(-MAX_PREFIX_CHARS), cacheKey)
          .then((raw) => {
            // Everything below guards against acting on a stale world. The
            // composer remounts this editor aggressively (channel switch,
            // reorder, editorType change), so a late response can easily arrive
            // after the view it was asked for is gone.
            if (id !== requestIdRef.current) return;
            if (!editor || editor.isDestroyed) return;
            if (editor.state.selection.head !== anchor) return;
            if (editor.state.doc.content.size !== docSize) return;

            const text = withJoiningSpace(
              normalizeSuggestion(raw, textBefore),
              textBefore
            );
            if (!text) return;
            if (getGhostState(editor.state).suppressed) return;

            editor.commands.setGhostSuggestion(text, anchor);
          })
          .catch(() => {
            // Aborts and network failures are both "no suggestion". A writer
            // must never be interrupted by this feature failing.
          });
      }, SUGGEST_DEBOUNCE_MS);
    };

    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
      cancelPending();
    };
  }, [editor, cancelPending, request]);

  // Turning the preference off mid-session should take effect immediately.
  useEffect(() => {
    if (enabled || !editor || editor.isDestroyed) return;
    cancelPending();
    if (GhostCompletionPluginKey.getState(editor.state)?.text) {
      editor.commands.clearGhostSuggestion();
    }
  }, [enabled, editor, cancelPending]);
};

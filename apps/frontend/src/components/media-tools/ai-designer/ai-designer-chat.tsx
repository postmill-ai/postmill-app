'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { FullscreenButton } from '@gitroom/frontend/components/media-tools/fullscreen-button';
import { useFullscreen } from '@gitroom/frontend/components/media-tools/use-fullscreen';
import { MessageRenderer } from './message-renderer';
import { useAiDesignerSession } from './ai-designer.hooks';
import {
  useAiDesignerSocket,
  type AiDesignerServerMessage,
  type AiDesignerSocketError,
} from './use-ai-designer-socket';
import type {
  AiDesignerMessagePayload,
  AiDesignerMode,
  AiDesignerProgressMsg,
  AiDesignerRenderResult,
  AiDesignerSessionDto,
} from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';

interface AiDesignerChatProps {
  sessionId: string;
  mode: AiDesignerMode;
  onReset?: () => void;
}

/** Local messages carry the emit nonce so the server echo can reconcile them. */
type ChatMessage = AiDesignerMessagePayload & { nonce?: string };

const SEND_SAFETY_TIMEOUT_MS = 10_000;

export const AiDesignerChat: React.FC<AiDesignerChatProps> = ({
  sessionId,
  mode,
  onReset,
}) => {
  const toaster = useToaster();
  const t = useT();
  const { isFullscreen } = useFullscreen();
  const { data: hydrate } = useAiDesignerSession(sessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionState, setSessionState] = useState<AiDesignerSessionDto | null>(null);
  const [progress, setProgress] = useState<AiDesignerProgressMsg | null>(null);
  const [preview, setPreview] = useState<AiDesignerRenderResult | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll when the user is already near the bottom — pinning
  // unconditionally would yank someone who scrolled up to re-read.
  const nearBottomRef = useRef(true);
  const pendingSendRef = useRef<{
    nonce: string;
    text: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (pendingSendRef.current) clearTimeout(pendingSendRef.current.timer);
    };
  }, []);

  // A send that will never echo back (server rejection, dropped delivery) was
  // never persisted — drop its optimistic bubble instead of rendering a lie,
  // and put the text back into the input so the user can retry.
  const failPendingSend = useCallback(() => {
    const pending = pendingSendRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSendRef.current = null;
    setMessages((prev) =>
      prev.filter(
        (m) => !(m.nonce === pending.nonce && m.id.startsWith('local-'))
      )
    );
    setInput((cur) => (cur.trim() ? cur : pending.text));
    setSending(false);
  }, []);

  const onMessage = useCallback((msg: AiDesignerServerMessage) => {
    // Server echo of our own message: reconcile the optimistic entry and
    // release the sending state.
    if (msg.nonce && pendingSendRef.current?.nonce === msg.nonce) {
      clearTimeout(pendingSendRef.current.timer);
      pendingSendRef.current = null;
      setSending(false);
    }
    // The conductor emits no terminal progress event — any real agent message
    // means the in-flight progress bubble is stale. Skip this for the user's
    // own echo so an in-flight render stays visible.
    if (msg.role !== 'user') {
      setProgress(null);
    }
    setMessages((prev) => {
      const next = msg.nonce
        ? prev.filter(
            (m) => !(m.nonce === msg.nonce && m.id.startsWith('local-'))
          )
        : prev;
      if (next.some((m) => m.id === msg.id)) return next;
      return [...next, msg];
    });
  }, []);

  const onSessionState = useCallback(
    (
      session: AiDesignerSessionDto | null,
      hydrated: AiDesignerMessagePayload[]
    ) => {
      setSessionState(session);
      // Resume path: session:state carries the persisted message history.
      if (hydrated.length) {
        setMessages((prev) => {
          const map = new Map<string, ChatMessage>();
          for (const m of hydrated) map.set(m.id, m);
          for (const m of prev) if (!map.has(m.id)) map.set(m.id, m);
          return Array.from(map.values());
        });
      }
      // A state hydrate means the current render finished before we reconnected;
      // any stale progress bubble is bogus.
      setProgress(null);
    },
    []
  );

  const onProgress = useCallback((p: AiDesignerProgressMsg) => {
    setProgress(p);
  }, []);

  const onPreview = useCallback((result: AiDesignerRenderResult) => {
    setPreview(result);
    // A preview means the render finished — drop the stale progress bubble.
    setProgress(null);
  }, []);

  const onError = useCallback(
    (err: AiDesignerSocketError) => {
      // A server-rejected message (e.g. guardrail_blocked) never echoes back —
      // fail the optimistic entry instead of waiting out the safety timer. A
      // nonce'd error for someone else's request must not touch our pending.
      if (!err.nonce || pendingSendRef.current?.nonce === err.nonce) {
        failPendingSend();
      }
      setSending(false);
      // An error mid-render means the in-flight progress bubble is stale.
      setProgress(null);
      toaster.show(
        err.message || err.code || t('ai_designer_error', 'AI Designer error'),
        'warning'
      );
    },
    [toaster, t, failPendingSend]
  );

  const socket = useAiDesignerSocket(
    {
      onMessage,
      onSessionState,
      onProgress,
      onPreview,
      onError,
    },
    { sessionId }
  );

  const allMessages = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of hydrate?.messages || []) map.set(m.id, m);
    for (const m of messages) map.set(m.id, m);
    return Array.from(map.values()).sort((a, b) => a.seq - b.seq);
  }, [hydrate?.messages, messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [allMessages, progress, preview]);

  const displaySession = sessionState ?? hydrate?.session ?? null;

  // Ephemeral progress/preview bubbles rendered as pseudo-messages.
  const progressMessage: AiDesignerMessagePayload | null = progress
    ? {
        id: 'progress',
        seq: 0,
        sessionId,
        role: 'agent',
        agent: progress.agent,
        kind: 'progress',
        content: progress,
        createdAt: new Date().toISOString(),
      }
    : null;

  const previewMessage: AiDesignerMessagePayload | null =
    preview && preview.outputPreviews.length > 0
      ? {
          id: 'preview',
          seq: 0,
          sessionId,
          role: 'assistant',
          kind: 'media',
          content: {
            kind: 'media',
            items: preview.outputPreviews.map((o) => ({
              url: o.url,
              type: 'image' as const,
              caption: o.formatId,
            })),
          },
          createdAt: new Date().toISOString(),
        }
      : null;

  const handleSend = () => {
    const text = input.trim();
    // Also guards the Enter path — the Send button's disabled state does not.
    if (!text || sending || !socket.connected) return;
    setSending(true);
    const nonce = socket.sendMessage(text);
    setInput('');
    // Optimistically append a user message so the UI feels responsive. The
    // server echo carries the same nonce and replaces this entry.
    const optimistic: ChatMessage = {
      id: `local-${nonce}`,
      nonce,
      seq: (allMessages[allMessages.length - 1]?.seq ?? 0) + 1,
      sessionId,
      role: 'user',
      kind: 'text',
      content: { kind: 'text', text },
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    if (pendingSendRef.current) clearTimeout(pendingSendRef.current.timer);
    pendingSendRef.current = {
      nonce,
      text,
      timer: setTimeout(() => {
        // No echo within the window — treat the send as undelivered.
        failPendingSend();
        toaster.show(
          t(
            'message_not_delivered_retry',
            'Your message was not delivered. Please try again.'
          ),
          'warning'
        );
      }, SEND_SAFETY_TIMEOUT_MS),
    };
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className={`flex flex-col h-full bg-studioBg${
        isFullscreen ? ' fixed inset-0 z-[100]' : ' rounded-[12px] overflow-hidden'
      }`}
    >
      <div className="flex items-center justify-between gap-[10px] px-[16px] h-[52px] border-b border-studioBorder shrink-0">
        <div className="flex items-center gap-[10px] min-w-0">
          <Logo size={22} className="" />
          <h1 className="text-[15px] font-[600] text-textColor whitespace-nowrap">
            {t('ai_designer', 'AI Designer')}
          </h1>
          {displaySession?.state && (
            <span className="text-[12px] text-textColor/50 capitalize truncate">
              {displaySession.state.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-[8px] shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              socket.connected ? 'bg-green-500' : 'bg-amber-500'
            }`}
            title={
              socket.connected
                ? t('status_connected', 'Connected')
                : t('status_disconnected', 'Disconnected')
            }
          />
          {!socket.connected && (
            <Button type="button" secondary onClick={socket.reconnect}>
              {t('reconnect', 'Reconnect')}
            </Button>
          )}
          {onReset && (
            <Button type="button" secondary onClick={onReset}>
              {t('new_design', 'New Design')}
            </Button>
          )}
          <FullscreenButton />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-[16px] space-y-4"
      >
        {allMessages.length === 0 && !progress && !preview && (
          <div className="text-center text-[14px] text-textColor/50 py-10">
            {(displaySession?.mode ?? mode) === 'prompt'
              ? t(
                  'prompt_sent_agent_will_respond',
                  'Your prompt has been sent. The agent will respond here.'
                )
              : t(
                  'describe_what_you_want_to_design',
                  'Describe what you want to design.'
                )}
          </div>
        )}

        {allMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg}>
            <MessageRenderer
              message={msg}
              onAcceptPlan={socket.acceptPlan}
              onRevisePlan={socket.revisePlan}
              onFormSubmit={socket.submitForm}
            />
          </MessageBubble>
        ))}

        {progressMessage && (
          <MessageBubble message={progressMessage}>
            <MessageRenderer
              message={progressMessage}
              onAcceptPlan={socket.acceptPlan}
              onRevisePlan={socket.revisePlan}
              onFormSubmit={socket.submitForm}
            />
          </MessageBubble>
        )}

        {previewMessage && (
          <MessageBubble message={previewMessage}>
            <MessageRenderer
              message={previewMessage}
              onAcceptPlan={socket.acceptPlan}
              onRevisePlan={socket.revisePlan}
              onFormSubmit={socket.submitForm}
            />
          </MessageBubble>
        )}
      </div>

      <div className="border-t border-studioBorder p-[12px] shrink-0">
        <div className="flex items-end gap-[10px]">
          <label htmlFor="ai-designer-message-input" className="sr-only">
            {t('message', 'Message')}
          </label>
          <textarea
            id="ai-designer-message-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('type_a_message_ellipsis', 'Type a message…')}
            rows={2}
            className="flex-1 min-h-[48px] max-h-[160px] rounded-lg border border-studioBorder bg-newBgColorInner p-3 text-[14px] text-textColor outline-none focus:border-designerAccent resize-none"
          />
          <Button
            type="button"
            loading={sending}
            disabled={!input.trim() || !socket.connected}
            onClick={handleSend}
          >
            {t('send', 'Send')}
          </Button>
        </div>
      </div>
    </div>
  );
};

const MessageBubble: React.FC<{
  message: AiDesignerMessagePayload;
  children: React.ReactNode;
}> = ({ message, children }) => {
  const isUser = message.role === 'user';
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 border ${
          isUser
            ? 'bg-designerAccent/20 border-designerAccent/30 rounded-br-md'
            : 'bg-newBgColorInner border-studioBorder rounded-bl-md'
        }`}
      >
        {message.agent && !isUser && (
          <div className="text-[11px] font-medium text-textColor/60 mb-1">
            {message.agent}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

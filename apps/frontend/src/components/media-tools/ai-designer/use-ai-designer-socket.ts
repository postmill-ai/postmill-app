'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type {
  AiDesignerAckPayload,
  AiDesignerAcceptPlanPayload,
  AiDesignerCancelPayload,
  AiDesignerFormSubmitPayload,
  AiDesignerMessagePayload,
  AiDesignerMessagePayloadDto,
  AiDesignerMode,
  AiDesignerProgressMsg,
  AiDesignerRenderResult,
  AiDesignerRevisePayload,
  AiDesignerSessionDto,
  AiDesignerStartPayload,
} from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';

export interface AiDesignerStartPayloadWithMode
  extends AiDesignerStartPayload {
  mode: AiDesignerMode;
}

/** Persisted user-authored message broadcasts carry the client's nonce back. */
export type AiDesignerServerMessage = AiDesignerMessagePayload & {
  nonce?: string;
};

export interface AiDesignerSessionStatePayload {
  session: AiDesignerSessionDto | null;
  messages: AiDesignerMessagePayload[];
}

export interface AiDesignerSocketError {
  code?: string;
  message: string;
  nonce?: string;
}

export interface AiDesignerSocketCallbacks {
  onSessionState?: (
    session: AiDesignerSessionDto | null,
    messages: AiDesignerMessagePayload[]
  ) => void;
  onMessage?: (msg: AiDesignerServerMessage) => void;
  onProgress?: (msg: AiDesignerProgressMsg) => void;
  onPreview?: (result: AiDesignerRenderResult) => void;
  onError?: (err: AiDesignerSocketError) => void;
}

function makeNonce(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  const token = match ? decodeURIComponent(match[1]) : '';
  return token || undefined;
}

export interface UseAiDesignerSocketOptions {
  /** Existing session to auto-join on connect/reconnect. */
  sessionId?: string | null;
  /** When false, no connection is opened (and any existing one is closed). */
  enabled?: boolean;
}

export function useAiDesignerSocket(
  callbacks: AiDesignerSocketCallbacks,
  options: UseAiDesignerSocketOptions = {}
) {
  const { backendUrl } = useVariables();
  const t = useT();
  const { sessionId, enabled = true } = options;
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const callbacksRef = useRef(callbacks);
  const lastAckRef = useRef(0);
  // socket.io fires connect_error on every retry attempt — report only the
  // first failure per outage so consumers don't toast ten times in a row.
  const connectErrorNotifiedRef = useRef(false);

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    // Gate inside the effect so the hook itself is called unconditionally.
    if (!enabled) return;

    connectErrorNotifiedRef.current = false;

    const socket = io(`${backendUrl}/ai-designer`, {
      withCredentials: true,
      // Polling-first with silent auto-upgrade to WebSocket (socket.io default order).
      // WS-first surfaced a failed upgrade ("Invalid frame header") as a connect_error
      // toast + reconnect loop on /media/ai-designer; polling connects immediately and the
      // WS upgrade happens in the background (or degrades gracefully behind proxies/LBs).
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      // Auth is re-evaluated on every connect/reconnect so the CSRF token,
      // target session, and last acked sequence stay current. socket.io's
      // function-form auth is callback-based — call cb() with the payload.
      auth: (cb) =>
        cb({
          csrfToken: getCsrfToken(),
          sessionId: sessionId ?? undefined,
          lastAcked: lastAckRef.current,
        }),
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      connectErrorNotifiedRef.current = false;
      if (lastAckRef.current > 0) {
        socket.emit('ack', { seq: lastAckRef.current } as AiDesignerAckPayload);
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', (err: Error) => {
      if (connectErrorNotifiedRef.current) return;
      connectErrorNotifiedRef.current = true;
      callbacksRef.current.onError?.({ message: err.message });
    });

    socket.on('session:state', (payload: AiDesignerSessionStatePayload) => {
      callbacksRef.current.onSessionState?.(
        payload?.session ?? null,
        payload?.messages ?? []
      );
    });

    socket.on('message', (msg: AiDesignerServerMessage) => {
      callbacksRef.current.onMessage?.(msg);
      if (msg.seq > lastAckRef.current) {
        lastAckRef.current = msg.seq;
      }
    });

    socket.on('agent:progress', (msg: AiDesignerProgressMsg) => {
      callbacksRef.current.onProgress?.(msg);
    });

    socket.on('preview', (result: AiDesignerRenderResult) => {
      callbacksRef.current.onPreview?.(result);
    });

    socket.on('error', (err: AiDesignerSocketError) => {
      callbacksRef.current.onError?.(err);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [backendUrl, sessionId, enabled]);

  const emit = useCallback(
    <T extends object>(event: string, payload: T): string => {
      const nonce = makeNonce();
      socketRef.current?.emit(event, { ...payload, nonce });
      return nonce;
    },
    []
  );

  // For user-intent actions: surface a failure (→ toast in the consumer) instead of
  // a silent no-op when the socket is down, so the click isn't quietly swallowed.
  const emitGuarded = useCallback(
    <T extends object>(event: string, payload: T): string => {
      if (!socketRef.current?.connected) {
        callbacksRef.current.onError?.({
          message: t(
            'not_connected_reconnecting_retry',
            'Not connected to the AI Designer — reconnecting, please try again.'
          ),
        });
      }
      return emit(event, payload);
    },
    [emit, t]
  );

  const start = useCallback(
    (payload: Omit<AiDesignerStartPayloadWithMode, 'nonce'>) => {
      return emit('start', payload);
    },
    [emit]
  );

  const sendMessage = useCallback(
    (text: string) => {
      return emit('message', { text } as Omit<
        AiDesignerMessagePayloadDto,
        'nonce'
      >);
    },
    [emit]
  );

  const submitForm = useCallback(
    (replyTo: string, values: Record<string, unknown>) => {
      return emitGuarded('form:submit', {
        replyTo,
        values,
      } as Omit<AiDesignerFormSubmitPayload, 'nonce'>);
    },
    [emitGuarded]
  );

  const acceptPlan = useCallback(
    (replyTo: string, variantId?: string, saveTemplate?: boolean) => {
      return emitGuarded('accept:plan', {
        replyTo,
        variantId,
        saveTemplate,
      } as Omit<AiDesignerAcceptPlanPayload, 'nonce'>);
    },
    [emitGuarded]
  );

  const revisePlan = useCallback(
    (instruction: string, targetDesignId?: string) => {
      return emitGuarded('revise', {
        instruction,
        targetDesignId,
      } as Omit<AiDesignerRevisePayload, 'nonce'>);
    },
    [emitGuarded]
  );

  const cancel = useCallback(() => {
    return emit('cancel', {} as Omit<AiDesignerCancelPayload, 'nonce'>);
  }, [emit]);

  const ack = useCallback((seq: number) => {
    lastAckRef.current = seq;
    socketRef.current?.emit('ack', { seq } as AiDesignerAckPayload);
  }, []);

  // Manual re-establish for when reconnect attempts are exhausted or the
  // server initiated the disconnect (socket.io won't auto-retry those).
  const reconnect = useCallback(() => {
    // A fresh manual attempt is a new outage cycle — let it report once again.
    connectErrorNotifiedRef.current = false;
    socketRef.current?.connect();
  }, []);

  return {
    connected,
    start,
    sendMessage,
    submitForm,
    acceptPlan,
    revisePlan,
    cancel,
    ack,
    reconnect,
  };
}

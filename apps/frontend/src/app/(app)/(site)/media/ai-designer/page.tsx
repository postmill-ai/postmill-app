'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AiDesignerStart } from '@gitroom/frontend/components/media-tools/ai-designer/ai-designer-start';
import { useAiDesignerSession } from '@gitroom/frontend/components/media-tools/ai-designer/ai-designer.hooks';
import { useToaster } from '@gitroom/react/toaster/toaster';
import {
  useAiDesignerSocket,
  type AiDesignerServerMessage,
} from '@gitroom/frontend/components/media-tools/ai-designer/use-ai-designer-socket';
import type {
  AiDesignerMode,
  AiDesignerSessionDto,
  AiDesignerStartPayload,
} from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';

const AiDesignerChat = dynamic(
  () =>
    import('@gitroom/frontend/components/media-tools/ai-designer/ai-designer-chat').then(
      (m) => m.AiDesignerChat
    ),
  { ssr: false }
);

const START_SAFETY_TIMEOUT_MS = 10_000;

function AiDesignerPageInner() {
  const toaster = useToaster();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Resume: the session id is persisted in the URL (?session=<id>) so a
  // refresh mid-generation re-enters the chat instead of losing it — the
  // chat hydrates history via GET /ai-designer/sessions/:id.
  const [sessionId, setSessionId] = useState<string | null>(
    () => searchParams.get('session')
  );
  const { data: hydrate, isLoading: hydrateLoading } =
    useAiDesignerSession(sessionId);
  const [mode, setMode] = useState<AiDesignerMode>('chat');
  const [starting, setStarting] = useState(false);
  const [pendingNonce, setPendingNonce] = useState<string | null>(null);
  // Guidance the gateway posts as a markdown message before rejecting a start
  // (e.g. missing model defaults) — rendered inline above the start form.
  const [startNotice, setStartNotice] = useState<string | null>(null);
  const startingRef = useRef(false);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStartTimer = useCallback(() => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearStartTimer, [clearStartTimer]);

  const callbacks = useMemo(
    () => ({
      // This socket only exists while on the start screen, so any
      // session:state (session:state carries no nonce) means our start —
      // or a resume — landed: enter the chat.
      onSessionState: (session: AiDesignerSessionDto | null) => {
        if (session?.id) {
          clearStartTimer();
          setSessionId(session.id);
          setPendingNonce(null);
          startingRef.current = false;
          setStarting(false);
          router.replace(`${pathname}?session=${session.id}`);
        }
      },
      // The gateway posts guidance (e.g. missing model defaults) as a
      // markdown message before rejecting a start — surface it on the form
      // instead of dropping it (only the error toast would show otherwise).
      // Gate on the start being in flight so a stray greeting can't flash as a
      // warning when the socket is just sitting on the start screen.
      onMessage: (msg: AiDesignerServerMessage) => {
        if (msg.content?.kind === 'markdown' && startingRef.current) {
          setStartNotice(msg.content.md);
        }
      },
      onError: (err: { code?: string; message: string; nonce?: string }) => {
        if (err.nonce && err.nonce !== pendingNonce) return;
        toaster.show(err.message || err.code || 'AI Designer error', 'warning');
        clearStartTimer();
        startingRef.current = false;
        setStarting(false);
        setPendingNonce(null);
      },
    }),
    [pendingNonce, toaster, router, pathname, clearStartTimer]
  );

  // Once a session is active the chat mounts its own socket — the page-level
  // one must not stay connected alongside it.
  const socket = useAiDesignerSocket(callbacks, { enabled: !sessionId });

  const handleStart = useCallback(
    (
      payload: Omit<AiDesignerStartPayload, 'nonce'> & { mode: AiDesignerMode }
    ) => {
      setStarting(true);
      startingRef.current = true;
      setMode(payload.mode);
      setStartNotice(null);
      const nonce = socket.start(payload);
      setPendingNonce(nonce);
      // Safety valve: if the server never answers (dropped socket, silent
      // rejection), release the start state instead of wedging forever.
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
      startTimerRef.current = setTimeout(() => {
        startTimerRef.current = null;
        startingRef.current = false;
        setStarting(false);
        setPendingNonce(null);
        toaster.show(
          'The AI Designer did not respond. Please try again.',
          'warning'
        );
      }, START_SAFETY_TIMEOUT_MS);
    },
    [socket, toaster]
  );

  const handleReset = useCallback(() => {
    clearStartTimer();
    setSessionId(null);
    setPendingNonce(null);
    startingRef.current = false;
    setStarting(false);
    setStartNotice(null);
    router.replace(pathname);
  }, [router, pathname, clearStartTimer]);

  // Invalid or expired ?session= query: once hydration finishes without a
  // result, drop back to the start screen instead of wedging on an empty chat.
  // Defer the reset to the next tick to avoid a synchronous setState cascade
  // inside the effect body.
  useEffect(() => {
    if (sessionId && !hydrateLoading && hydrate === null) {
      const t = setTimeout(() => {
        toaster.show(
          'Session expired or not found. Starting a new design.',
          'warning'
        );
        handleReset();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [sessionId, hydrateLoading, hydrate, toaster, handleReset]);

  if (sessionId) {
    return <AiDesignerChat sessionId={sessionId} mode={mode} onReset={handleReset} />;
  }

  return (
    <AiDesignerStart
      onStart={handleStart}
      isStarting={starting}
      isConnected={socket.connected}
      onReconnect={socket.reconnect}
      notice={startNotice}
    />
  );
}

export default function AiDesignerPage() {
  return (
    <Suspense fallback={null}>
      <AiDesignerPageInner />
    </Suspense>
  );
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

const hoisted = vi.hoisted(() => ({
  socketCallbacks: {} as any,
  socket: {} as any,
  lastRendererProps: {} as any,
  hydrate: undefined as any,
}));

vi.mock('./use-ai-designer-socket', () => ({
  useAiDesignerSocket: (callbacks: any) => {
    hoisted.socketCallbacks = callbacks;
    return hoisted.socket;
  },
}));

vi.mock('./ai-designer.hooks', () => ({
  useAiDesignerSession: () => ({ data: hoisted.hydrate }),
}));

vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock('@postmill-ai/frontend/components/new-layout/logo', () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock('@postmill-ai/frontend/components/media-tools/fullscreen-button', () => ({
  FullscreenButton: () => <div data-testid="fullscreen-button" />,
}));

// Must be the alias path the component actually imports — this used to target
// './use-fullscreen', which resolves to a file that doesn't exist beside this
// spec, so the factory never applied and the real hook ran.
vi.mock('@postmill-ai/frontend/components/media-tools/use-fullscreen', () => ({
  useFullscreen: () => ({ isFullscreen: false, toggle: vi.fn() }),
  useFullscreenSurface: () => 'rounded-[12px] overflow-hidden',
}));

// Light stand-in for the real renderer: progress bubbles show agent + phase,
// everything else a marker. The action props are the chat's own wrappers, so
// invoking them exercises the real send paths.
vi.mock('./message-renderer', () => ({
  MessageRenderer: (props: any) => {
    hoisted.lastRendererProps = props;
    if (props.message.kind === 'progress') {
      return (
        <div data-testid="progress-bubble">
          {props.message.content.agent}: {props.message.content.phase}
        </div>
      );
    }
    return <div data-testid={`msg-${props.message.id}`} />;
  },
  TypingIndicator: () => <div data-testid="typing" />,
}));

import { AiDesignerChat } from './ai-designer-chat';

const SESSION_ID = 'session-1';

const serverMessage = (overrides: Record<string, unknown> = {}) => ({
  id: 'srv-1',
  seq: 1,
  sessionId: SESSION_ID,
  role: 'assistant',
  agent: 'conversationalist',
  kind: 'text',
  content: { kind: 'text', text: 'Hello!' },
  createdAt: new Date().toISOString(),
  ...overrides,
});

const sendChatMessage = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText('Type a message…'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByText('Send'));
};

describe('AiDesignerChat thinking bubble', () => {
  beforeEach(() => {
    hoisted.socket = {
      connected: true,
      sendMessage: vi.fn().mockReturnValue('nonce-1'),
      submitForm: vi.fn().mockReturnValue('nonce-2'),
      acceptPlan: vi.fn().mockReturnValue('nonce-3'),
      revisePlan: vi.fn().mockReturnValue('nonce-4'),
      cancel: vi.fn(),
      ack: vi.fn(),
      reconnect: vi.fn(),
    };
    hoisted.lastRendererProps = {};
    hoisted.hydrate = undefined;
  });

  it('shows the thinking bubble immediately when a message is sent', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    sendChatMessage('a meme about cats');

    expect(hoisted.socket.sendMessage).toHaveBeenCalledWith('a meme about cats');
    expect(screen.getByTestId('progress-bubble').textContent).toBe(
      'assistant: Thinking…'
    );
  });

  it('replaces the thinking bubble with the first real agent:progress event', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    sendChatMessage('a meme about cats');
    expect(screen.getByTestId('progress-bubble')).toBeTruthy();

    act(() => {
      hoisted.socketCallbacks.onProgress({
        kind: 'progress',
        agent: 'composer',
        phase: 'Composing variant v1',
      });
    });

    expect(screen.getByTestId('progress-bubble').textContent).toBe(
      'composer: Composing variant v1'
    );
  });

  it('clears the bubble on the first non-user message', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    sendChatMessage('a meme about cats');
    expect(screen.getByTestId('progress-bubble')).toBeTruthy();

    act(() => {
      hoisted.socketCallbacks.onMessage(serverMessage());
    });

    expect(screen.queryByTestId('progress-bubble')).toBeNull();
    expect(screen.getByTestId('msg-srv-1')).toBeTruthy();
  });

  it('shows the thinking bubble for intake form submits', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    act(() => {
      hoisted.socketCallbacks.onMessage(serverMessage());
    });

    act(() => {
      hoisted.lastRendererProps.onFormSubmit('srv-1', { intent: 'cats' });
    });

    expect(hoisted.socket.submitForm).toHaveBeenCalledWith('srv-1', {
      intent: 'cats',
    });
    expect(screen.getByTestId('progress-bubble').textContent).toBe(
      'assistant: Thinking…'
    );
  });

  it('forwards edited plan texts to the acceptPlan socket emit', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    act(() => {
      hoisted.socketCallbacks.onMessage(serverMessage());
    });

    const texts = { v1: { headline: 'Final Hours!', cta: 'Shop Now' } };
    act(() => {
      hoisted.lastRendererProps.onAcceptPlan('srv-1', 'v1', texts);
    });

    expect(hoisted.socket.acceptPlan).toHaveBeenCalledWith('srv-1', 'v1', texts);
  });

  it('shows the thinking bubble for plan-card actions', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    act(() => {
      hoisted.socketCallbacks.onMessage(serverMessage());
    });

    act(() => {
      hoisted.lastRendererProps.onAcceptPlan('srv-1', 'v1', undefined);
    });

    expect(hoisted.socket.acceptPlan).toHaveBeenCalledWith(
      'srv-1',
      'v1',
      undefined
    );
    expect(screen.getByTestId('progress-bubble').textContent).toBe(
      'assistant: Thinking…'
    );

    act(() => {
      hoisted.socketCallbacks.onProgress({
        kind: 'progress',
        agent: 'composer',
        phase: 'executing',
      });
    });
    expect(screen.getByTestId('progress-bubble').textContent).toBe(
      'composer: executing'
    );

    act(() => {
      hoisted.lastRendererProps.onRevisePlan('more ideas');
    });

    expect(hoisted.socket.revisePlan).toHaveBeenCalledWith(
      'more ideas',
      undefined
    );
    expect(screen.getByTestId('progress-bubble').textContent).toBe(
      'assistant: Thinking…'
    );
  });
});

describe('AiDesignerChat cancel affordance', () => {
  beforeEach(() => {
    hoisted.socket = {
      connected: true,
      sendMessage: vi.fn().mockReturnValue('nonce-1'),
      submitForm: vi.fn().mockReturnValue('nonce-2'),
      acceptPlan: vi.fn().mockReturnValue('nonce-3'),
      revisePlan: vi.fn().mockReturnValue('nonce-4'),
      cancel: vi.fn(),
      ack: vi.fn(),
      reconnect: vi.fn(),
    };
    hoisted.lastRendererProps = {};
    hoisted.hydrate = undefined;
  });

  it('renders a Cancel button while progress is shown, not when idle', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    sendChatMessage('a meme about cats');

    expect(screen.getByTestId('progress-bubble')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('hides the Cancel button once the progress bubble clears', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    sendChatMessage('a meme about cats');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    act(() => {
      hoisted.socketCallbacks.onMessage(serverMessage());
    });

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('emits cancel once — the button disables after the first click', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    sendChatMessage('a meme about cats');
    const button = screen.getByRole('button', { name: 'Cancel' });

    fireEvent.click(button);
    expect(hoisted.socket.cancel).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    // The bubble stays until the backend's rollback events clear it, and a
    // second click must not re-emit.
    expect(screen.getByTestId('progress-bubble')).toBeTruthy();
    fireEvent.click(button);
    expect(hoisted.socket.cancel).toHaveBeenCalledTimes(1);
  });

  it('re-arms cancel when a new progress event replaces the bubble', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    sendChatMessage('a meme about cats');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(hoisted.socket.cancel).toHaveBeenCalledTimes(1);

    act(() => {
      hoisted.socketCallbacks.onProgress({
        kind: 'progress',
        agent: 'composer',
        phase: 'Composing variant v1',
      });
    });

    const button = screen.getByRole('button', { name: 'Cancel' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(hoisted.socket.cancel).toHaveBeenCalledTimes(2);
  });
});

// The conductor persists a `progress` row per phase transition, and neither read
// path (REST hydrate or the socket's after-seq replay) filters by kind — so every
// historical "Thinking…" came back on reload and re-rendered as a live-looking
// animated indicator. Thinking is a transient state, never transcript.
describe('AiDesignerChat thinking never persists', () => {
  const progressRow = (id: string, seq: number) => ({
    id,
    seq,
    sessionId: SESSION_ID,
    role: 'agent',
    agent: 'art-director',
    kind: 'progress',
    content: { kind: 'progress', agent: 'art-director', phase: 'Sketching concepts…' },
    createdAt: new Date().toISOString(),
  });

  const textRow = (id: string, seq: number) => ({
    id,
    seq,
    sessionId: SESSION_ID,
    role: 'assistant',
    kind: 'text',
    content: 'Here are some concepts.',
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    hoisted.socket = {
      connected: true,
      sendMessage: vi.fn().mockReturnValue('nonce-1'),
      submitForm: vi.fn(),
      acceptPlan: vi.fn(),
      revisePlan: vi.fn(),
      cancel: vi.fn(),
      ack: vi.fn(),
      reconnect: vi.fn(),
    };
    hoisted.hydrate = undefined;
  });

  it('drops hydrated progress rows from the transcript', () => {
    hoisted.hydrate = {
      session: { id: SESSION_ID, mode: 'chat', state: 'designing' },
      messages: [progressRow('p1', 1), textRow('m1', 2), progressRow('p2', 3)],
    };

    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    // The real message survives; neither stored thinking row renders.
    expect(screen.getByTestId('msg-m1')).toBeTruthy();
    expect(screen.queryByTestId('progress-bubble')).toBeNull();
  });

  it('drops progress rows replayed over the socket after a reconnect', () => {
    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);

    act(() => {
      hoisted.socketCallbacks.onSessionState(
        { id: SESSION_ID, mode: 'chat', state: 'designing' },
        [progressRow('p9', 7), textRow('m9', 8)]
      );
    });

    expect(screen.getByTestId('msg-m9')).toBeTruthy();
    expect(screen.queryByTestId('progress-bubble')).toBeNull();
  });

  it('still shows the live indicator while a turn is in flight', () => {
    hoisted.hydrate = {
      session: { id: SESSION_ID, mode: 'chat', state: 'designing' },
      messages: [progressRow('p1', 1)],
    };

    render(<AiDesignerChat sessionId={SESSION_ID} mode="chat" />);
    expect(screen.queryByTestId('progress-bubble')).toBeNull();

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'another one' },
    });
    fireEvent.click(screen.getByText('Send'));

    // Ephemeral, and distinct from anything that was stored.
    expect(screen.getByTestId('progress-bubble').textContent).toBe(
      'assistant: Thinking…'
    );
  });
});

import React from 'react';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// ---- mock the heavy module graph agent.chat imports so we can load it under
// jsdom and render <LoadMessages> in isolation. Only the identifiers used at
// module-eval time need to resolve. ----

const setMessages = vi.fn();

vi.mock('@copilotkit/react-core', () => ({
  CopilotKit: ({ children }: any) => <>{children}</>,
  useCopilotAction: () => undefined,
  useDefaultTool: () => undefined,
  useCopilotMessagesContext: () => ({ setMessages, messages: [] }),
}));

vi.mock('@copilotkit/react-ui', () => ({
  CopilotChat: () => <div />,
}));

vi.mock('@copilotkit/runtime-client-gql', () => ({
  TextMessage: class TextMessage {
    content: string;
    role: string;
    constructor(o: { content: string; role: string }) {
      this.content = o.content;
      this.role = o.role;
    }
  },
}));

vi.mock('@gitroom/frontend/components/composer/composer', () => ({
  Composer: () => <div />,
}));

vi.mock('@gitroom/frontend/components/agents/agent', () => ({
  MediaPortal: () => <div />,
  PropertiesContext: React.createContext({ properties: [] }),
}));

vi.mock('@gitroom/frontend/components/agents/agent.input', () => ({
  Input: () => <div />,
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: vi.fn() }),
}));

vi.mock('@gitroom/frontend/components/launches/helpers/use.existing.data', () => ({
  ExistingDataContextProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock('@gitroom/frontend/components/shared/safe-content', () => ({
  SafeContent: () => <div />,
}));

vi.mock('@gitroom/frontend/components/agent/agent-context-bridge', () => ({
  AgentContextBridge: () => null,
}));

vi.mock('@gitroom/frontend/components/layout/use-ai-active', () => ({
  useAiActive: () => true,
  AI_SETUP_HREF: '/settings/ai/llm-providers',
}));

vi.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: 'http://x' }),
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_k: string, fallback?: string) => fallback || _k,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'new' }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('swr', () => ({
  default: vi.fn(),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

// A controllable fetch: each call parks a resolver keyed by url so the test can
// resolve responses in an arbitrary (racing) order.
const resolvers = new Map<string, (messages: any[]) => void>();
const fetchMock = vi.fn((url: string) => {
  return new Promise((resolveResponse) => {
    resolvers.set(url, (messages: any[]) =>
      resolveResponse({ json: () => Promise.resolve({ messages }) })
    );
  });
});

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

import { LoadMessages, SPECIALIST_BY_TOOL, PendingApprovalCard } from './agent.chat';
import { fireEvent, waitFor } from '@testing-library/react';

const msg = (content: string) => ({ role: 'user', content: { content } });

describe('LoadMessages thread-switch race (7.1)', () => {
  beforeEach(() => {
    setMessages.mockClear();
    fetchMock.mockClear();
    resolvers.clear();
  });

  it("a slow response for a previous thread never overwrites the current one", async () => {
    const view = render(<LoadMessages id="A" />);
    // Switch to thread B before A's fetch resolves.
    view.rerender(<LoadMessages id="B" />);

    // B resolves first (fresh thread).
    await act(async () => {
      resolvers.get('/copilot/B/list')!([msg('B')]);
    });
    // A resolves late — its effect was cancelled on switch, so it must be ignored.
    await act(async () => {
      resolvers.get('/copilot/A/list')!([msg('A')]);
    });

    const applied = setMessages.mock.calls
      .map((c) => c[0])
      .filter((arg) => Array.isArray(arg) && arg.length > 0);

    // The only non-empty apply is B; A's stale response was dropped.
    expect(applied).toHaveLength(1);
    expect(applied[0][0].content).toBe('B');
    expect(
      applied.some((arr) => arr.some((m: any) => m.content === 'A'))
    ).toBe(false);
  });
});

// ---- 7.3: the visibility map must cover every real backend tool name. The
// backend arrays live in modules with heavy server deps, so read them off disk
// (import-free) and assert the frontend map is in lockstep — this fails if a
// tool is renamed/added on the backend without updating SPECIALIST_BY_TOOL. ----

const repoRoot = (): string => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'libraries/nestjs-libraries'))) return dir;
    dir = join(dir, '..');
  }
  throw new Error('repo root not found from ' + process.cwd());
};

const readToolNames = (relPath: string, arrayName: string): string[] => {
  const src = readFileSync(join(repoRoot(), relPath), 'utf8');
  const block = src.match(
    new RegExp(`${arrayName}\\s*=\\s*\\[([\\s\\S]*?)\\]`)
  );
  if (!block) throw new Error(`could not find ${arrayName} in ${relPath}`);
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

describe('SPECIALIST_BY_TOOL is in lockstep with backend tool names (7.3)', () => {
  const cases: Array<[string, string, string]> = [
    ['libraries/nestjs-libraries/src/chat/agents/content.agent.ts', 'CONTENT_TOOL_NAMES', 'content'],
    ['libraries/nestjs-libraries/src/chat/agents/media.agent.ts', 'MEDIA_TOOL_NAMES', 'media'],
    ['libraries/nestjs-libraries/src/chat/agents/analytics.agent.ts', 'ANALYTICS_TOOL_NAMES', 'analytics'],
    ['libraries/nestjs-libraries/src/chat/agents/ops.agent.ts', 'OPS_TOOL_NAMES', 'ops'],
    ['libraries/nestjs-libraries/src/chat/load.tools.service.ts', 'SUPERVISOR_TOOL_NAMES', 'ops'],
  ];

  it.each(cases)('%s → maps every tool to %s', (file, arrayName, specialist) => {
    const names = readToolNames(file, arrayName);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(SPECIALIST_BY_TOOL[name]).toBe(specialist);
    }
  });

  it('maps the supervisor delegation tools', () => {
    expect(SPECIALIST_BY_TOOL['agent-content']).toBe('content');
    expect(SPECIALIST_BY_TOOL['agent-media']).toBe('media');
    expect(SPECIALIST_BY_TOOL['agent-analytics']).toBe('analytics');
    expect(SPECIALIST_BY_TOOL['agent-ops']).toBe('ops');
  });
});

// 3.2 — an ambiguous approve failure must not double-dispatch: a retry re-sends the
// SAME X-Idempotency-Key so the server can dedupe.
describe('PendingApprovalCard idempotency (3.2)', () => {
  const pending = {
    key: 'comment:p1::0',
    kind: 'comment' as const,
    draft: { action: 'reply', postId: 'p1', message: 'hi there' },
  };

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('a retry after a network error re-sends the same idempotency key', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({ ok: true, text: async () => '', json: async () => ({}) });

    const view = render(<PendingApprovalCard pending={pending} />);
    const approveBtn = () =>
      Array.from(view.container.querySelectorAll('button')).find((b) =>
        /approve|sending/i.test(b.textContent || '')
      )!;

    // First attempt fails (ambiguous — server may have accepted).
    await act(async () => {
      fireEvent.click(approveBtn());
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Retry — the card is still offering Approve (resolved stayed null).
    await act(async () => {
      fireEvent.click(approveBtn());
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const key1 = fetchMock.mock.calls[0][1].headers['X-Idempotency-Key'];
    const key2 = fetchMock.mock.calls[1][1].headers['X-Idempotency-Key'];
    expect(key1).toBeTruthy();
    expect(key2).toBe(key1);
    // Same outward route both times.
    expect(fetchMock.mock.calls[0][0]).toBe('/posts/p1/social-comments');
  });
});

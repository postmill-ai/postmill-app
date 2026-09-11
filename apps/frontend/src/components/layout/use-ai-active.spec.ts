import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockData: { active: unknown; agentReady?: boolean } | undefined;
let mockIsLoading = false;

vi.mock('swr', () => ({
  default: () => ({ data: mockData, isLoading: mockIsLoading }),
}));

const mockFetch = vi.fn();
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

import { useAiActive } from './use-ai-active';

describe('useAiActive', () => {
  beforeEach(() => {
    mockData = undefined;
    mockIsLoading = false;
    mockFetch.mockReset();
  });

  it('returns undefined while loading', () => {
    mockIsLoading = true;
    const { result } = renderHook(() => useAiActive());
    expect(result.current).toBeUndefined();
  });

  it('returns false when no provider is active', () => {
    mockData = { active: null, agentReady: false };
    const { result } = renderHook(() => useAiActive());
    expect(result.current).toBe(false);
  });

  it('returns true when a provider is active AND agent scope resolves', () => {
    mockData = { active: { identifier: 'openai' }, agentReady: true };
    const { result } = renderHook(() => useAiActive());
    expect(result.current).toBe(true);
  });

  it('returns false when a provider is active but agent scope cannot resolve', () => {
    // Sentry POSTMILL-APP-D/E/F: an active row with incomplete credentials
    // must NOT mount CopilotKit — the /copilot/chat handshake would reject
    // ("No default agent provided") and crash the client sync.
    mockData = { active: { identifier: 'google' }, agentReady: false };
    const { result } = renderHook(() => useAiActive());
    expect(result.current).toBe(false);
  });
});

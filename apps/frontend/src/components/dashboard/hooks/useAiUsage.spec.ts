import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAiUsage, AiUsageResponse } from './useAiUsage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

const swrState = {
  data: undefined as AiUsageResponse | undefined,
  error: undefined as Error | undefined,
  isLoading: false,
  mutate: vi.fn(),
};

vi.mock('swr', () => ({
  default: vi.fn(() => swrState),
}));

describe('useAiUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrState.data = undefined;
    swrState.error = undefined;
    swrState.isLoading = false;
    swrState.mutate = vi.fn();
  });

  it('returns a loading state while fetching', () => {
    swrState.isLoading = true;

    const { result } = renderHook(() => useAiUsage());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('returns AI usage data when loaded', () => {
    const usage: AiUsageResponse = {
      byScope: [{ scope: 'utility', _sum: { costUsd: 1.23 } }],
      byProvider: [],
      totalSpendUsd: 12.34,
      monthlySpendUsd: 5,
      dailySpendUsd: 0.5,
      budget: {
        monthlyCap: 100,
        dailyCap: 10,
        remainingMonthly: 88.66,
        remainingDaily: 9.5,
      },
    };
    swrState.data = usage;
    swrState.isLoading = false;

    const { result } = renderHook(() => useAiUsage());

    expect(result.current.data).toEqual(usage);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('returns per-provider spend and caps when byProvider is populated', () => {
    const usage: AiUsageResponse = {
      byScope: [{ scope: 'utility', _sum: { costUsd: 1.23 } }],
      byProvider: [
        {
          provider: 'openai',
          monthlySpendUsd: 8.5,
          dailySpendUsd: 1.25,
          monthlyCap: 50,
          dailyCap: 10,
          remainingMonthly: 41.5,
          remainingDaily: 8.75,
        },
      ],
      totalSpendUsd: 12.34,
      monthlySpendUsd: 8.5,
      dailySpendUsd: 1.25,
      budget: null,
    };
    swrState.data = usage;

    const { result } = renderHook(() => useAiUsage());

    expect(result.current.data?.byProvider).toHaveLength(1);
    expect(result.current.data?.byProvider[0]).toMatchObject({
      provider: 'openai',
      monthlyCap: 50,
      remainingMonthly: 41.5,
    });
  });

  it('returns an empty/no-data state when data is missing', () => {
    swrState.data = undefined;
    swrState.isLoading = false;
    swrState.error = undefined;

    const { result } = renderHook(() => useAiUsage());

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces an error state from SWR', () => {
    const err = new Error('Failed to load AI usage');
    swrState.error = err;

    const { result } = renderHook(() => useAiUsage());

    expect(result.current.error).toBe(err);
  });

  it('exposes the SWR mutate function for refreshes', () => {
    const mutate = vi.fn();
    swrState.mutate = mutate;

    const { result } = renderHook(() => useAiUsage());

    expect(result.current.mutate).toBe(mutate);
  });
});

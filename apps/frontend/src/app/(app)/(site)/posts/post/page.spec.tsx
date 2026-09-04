import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

// Composer pulls in the whole launch store tree; stub it — this spec covers the
// page-level zero-channel guard, not the composer.
vi.mock('@postmill-ai/frontend/components/composer/composer', () => ({
  Composer: () => <div data-testid="composer" />,
}));

vi.mock('@postmill-ai/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div data-testid="loading" />,
}));

const mockAddChannel = vi.fn();
vi.mock(
  '@postmill-ai/frontend/components/launches/add.provider.component',
  () => ({
    useAddProvider: () => mockAddChannel,
  })
);

const mockPermissions = vi.fn();
vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => mockPermissions(),
}));

const mockUseSWR = vi.fn();
vi.mock('swr', () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

import CreatePostPage from './page';

function stubSWR(over: any = {}) {
  mockUseSWR.mockReturnValue({
    data: [],
    isLoading: false,
    mutate: vi.fn(),
    ...over,
  });
}

function stubPermissions(over: any = {}) {
  mockPermissions.mockReturnValue({
    isResolved: true,
    hasPermission: () => true,
    ...over,
  });
}

describe('CreatePostPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPermissions();
  });

  it('renders the loading state while integrations load', () => {
    stubSWR({ isLoading: true });
    render(<CreatePostPage />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('renders the composer when channels exist', () => {
    stubSWR({ data: [{ id: 'int-1' }] });
    render(<CreatePostPage />);
    expect(screen.getByTestId('composer')).toBeTruthy();
  });

  it('renders an empty state with Add Channel when no channels exist', () => {
    stubSWR({ data: [] });
    render(<CreatePostPage />);
    expect(screen.getByText('No channels connected')).toBeTruthy();
    fireEvent.click(screen.getByText('Add Channel'));
    expect(mockAddChannel).toHaveBeenCalled();
  });

  it('hides the Add Channel action for users without channels:create', () => {
    stubSWR({ data: [] });
    stubPermissions({ hasPermission: () => false });
    render(<CreatePostPage />);
    expect(
      screen.getByText('Ask an admin to connect a channel before composing posts.')
    ).toBeTruthy();
    expect(screen.queryByText('Add Channel')).toBeNull();
  });
});

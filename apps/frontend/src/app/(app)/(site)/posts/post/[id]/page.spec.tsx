import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditPostPage from './page';

dayjs.extend(utc);

const pushMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'group-1' }),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@postmill-ai/frontend/components/composer/composer', () => ({
  Composer: () => <div data-testid="composer" />,
}));

vi.mock('@postmill-ai/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div data-testid="loading" />,
}));

const response = (ok: boolean, body: unknown) =>
  ({ ok, json: async () => body }) as Response;

const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <EditPostPage />
    </SWRConfig>
  );

const stubGroup = (ok: boolean, body: unknown) => {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/integrations/list') {
      return response(true, { integrations: [{ id: 'channel-1' }] });
    }
    if (path === '/posts/group/group-1') {
      return response(ok, body);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
};

const validGroup = {
  group: 'group-1',
  integration: 'channel-1',
  settings: {},
  posts: [
    {
      id: 'post-1',
      publishDate: '2026-11-04T12:00:00.000Z',
      content: '<p>Test</p>',
      image: [],
    },
  ],
};

describe('EditPostPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the loading state while the group is unresolved', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('renders the composer for a valid group', async () => {
    stubGroup(true, validGroup);
    renderPage();
    expect(await screen.findByTestId('composer')).toBeTruthy();
  });

  it('renders Post not found for a non-OK group response', async () => {
    stubGroup(false, { statusCode: 404, message: 'Post not found' });
    renderPage();

    expect(await screen.findByText('Post not found')).toBeTruthy();
    fireEvent.click(screen.getByText('Back to posts'));
    expect(pushMock).toHaveBeenCalledWith('/posts');
  });

  it.each([{ posts: [] }, { statusCode: 500, message: 'Internal server error' }])(
    'renders Post not found for an invalid successful payload: %j',
    async (body) => {
      stubGroup(true, body);
      renderPage();
      expect(await screen.findByText('Post not found')).toBeTruthy();
      expect(screen.queryByTestId('composer')).toBeNull();
    }
  );
});

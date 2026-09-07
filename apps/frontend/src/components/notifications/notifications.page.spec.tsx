import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockFetchFn = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback?: string, vars?: Record<string, string>) =>
      (fallback ?? _key).replace(
        /\{\{(\w+)\}\}/g,
        (m, k) => vars?.[k] ?? m
      ),
}));

const makeNotification = (id: string, readAt: string | null = null) => ({
  id,
  type: 'channels',
  title: `Notification ${id}`,
  content: `Content ${id}`,
  link: null,
  metadata: null,
  createdAt: '2026-09-07T12:00:00.000Z',
  readAt,
});

const page0 = {
  notifications: [makeNotification('n1'), makeNotification('n2', '2026-09-07T13:00:00.000Z')],
  total: 2,
  page: 0,
  limit: 100,
  hasMore: false,
};

const defaultFetchImpl = (url: string, init?: { method?: string }) => {
  if (typeof url === 'string' && url.startsWith('/notifications/list') && !init) {
    return Promise.resolve({ ok: true, json: async () => page0 });
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchFn.mockImplementation(defaultFetchImpl);
});

describe('NotificationsPage', () => {
  it('renders the paginated notifications list', async () => {
    const { NotificationsPage } = await import('./notifications.page');
    render(<NotificationsPage />, { wrapper });

    expect(await screen.findByText('Notification n1')).toBeDefined();
    expect(screen.getByText('Notification n2')).toBeDefined();
    expect(mockFetchFn).toHaveBeenCalledWith('/notifications/list?page=0');
  });

  it('marks a notification read via PATCH and deletes via DELETE', async () => {
    const { NotificationsPage } = await import('./notifications.page');
    render(<NotificationsPage />, { wrapper });

    // n1 is unread → has a Read action (visible on row hover).
    const readButton = await screen.findByText('Read');
    fireEvent.click(readButton);
    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith('/notifications/n1/read', {
        method: 'PATCH',
      });
    });

    const deleteButtons = screen.getAllByText('Delete');
    fireEvent.click(deleteButtons[1]);
    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith('/notifications/n2', {
        method: 'DELETE',
      });
    });
  });

  it('marks all read via POST /notifications/read-all', async () => {
    const { NotificationsPage } = await import('./notifications.page');
    render(<NotificationsPage />, { wrapper });

    fireEvent.click(await screen.findByText('Mark all read'));
    await waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith('/notifications/read-all', {
        method: 'POST',
      });
    });
  });

  it('hides the pager when everything fits on one page', async () => {
    const { NotificationsPage } = await import('./notifications.page');
    render(<NotificationsPage />, { wrapper });

    await screen.findByText('Notification n1');
    expect(screen.queryByText('Next')).toBeNull();
  });

  it('shows the pager when there is more than one page', async () => {
    mockFetchFn.mockImplementation((url: string, init?: { method?: string }) => {
      if (typeof url === 'string' && url.startsWith('/notifications/list') && !init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...page0, total: 250, hasMore: true }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { NotificationsPage } = await import('./notifications.page');
    render(<NotificationsPage />, { wrapper });

    expect(await screen.findByText('Next')).toBeDefined();
    expect(screen.getByText('Page 1 of 3')).toBeDefined();
    expect(screen.getByText('Previous')).toHaveProperty('disabled', true);
  });

  it('links to the notification preferences page', async () => {
    const { NotificationsPage } = await import('./notifications.page');
    render(<NotificationsPage />, { wrapper });

    await screen.findByText('Notification n1');
    const link = screen.getByText('Notification preferences');
    expect(link.getAttribute('href')).toBe('/user/me/notifications');
  });
});

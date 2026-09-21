import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockFetchFn = vi.fn();
const mockToasterShow = vi.fn();
const mockT = vi.fn((_key: string, fallback?: string) => fallback ?? _key);
const mockHasPermission = vi.fn(() => true);
let permissionsResolved = true;

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));
vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ isResolved: permissionsResolved, hasPermission: mockHasPermission }),
}));

const budgetResponse = { monthlyCap: 10, dailyCap: null, alertThresholdPct: 0.8 };

const fetchImpl = (url: unknown, init?: { method?: string }) => {
  if (url === '/settings/ai/budget' && !init?.method) {
    return Promise.resolve({ ok: true, json: async () => budgetResponse });
  }
  return Promise.resolve({ ok: true, json: async () => ({ ...budgetResponse }) });
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

const lastPutBody = () => {
  const call = mockFetchFn.mock.calls.find(([, init]) => init?.method === 'PUT');
  return call ? JSON.parse(call[1].body) : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  permissionsResolved = true;
  mockHasPermission.mockReturnValue(true);
  mockFetchFn.mockImplementation(fetchImpl);
});

describe('OrgBudgetCard', () => {
  it('seeds the form from GET /settings/ai/budget (enabled, caps, slider as a percentage)', async () => {
    const { OrgBudgetCard } = await import('./org-budget.card');
    render(<OrgBudgetCard />, { wrapper });

    const monthly = (await screen.findByPlaceholderText('e.g. 100')) as HTMLInputElement;
    expect(monthly.value).toBe('10');
    expect((screen.getByPlaceholderText('e.g. 10') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('80%')).toBeTruthy();
    expect(mockFetchFn).toHaveBeenCalledWith('/settings/ai/budget');
  });

  it('saves monthly/daily caps and the slider as a 0–1 fraction, then toasts and refreshes usage', async () => {
    const { OrgBudgetCard } = await import('./org-budget.card');
    render(<OrgBudgetCard />, { wrapper });

    const monthly = await screen.findByPlaceholderText('e.g. 100');
    fireEvent.change(monthly, { target: { value: '25' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Save budget'));

    await waitFor(() => expect(lastPutBody()).toEqual({ monthlyCap: 25, dailyCap: 2, alertThresholdPct: 0.5 }));
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Organization budget saved', 'success'),
    );
  });

  it('toggling the limit off saves all three caps as null', async () => {
    const { OrgBudgetCard } = await import('./org-budget.card');
    render(<OrgBudgetCard />, { wrapper });

    const toggle = (await screen.findByRole('checkbox')) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('Save budget'));

    await waitFor(() =>
      expect(lastPutBody()).toEqual({ monthlyCap: null, dailyCap: null, alertThresholdPct: null }),
    );
  });

  it('shows a warning toast and no success when the save fails', async () => {
    mockFetchFn.mockImplementation((url: unknown, init?: { method?: string }) =>
      init?.method === 'PUT'
        ? Promise.resolve({ ok: false, json: async () => ({}) })
        : fetchImpl(url, init),
    );
    const { OrgBudgetCard } = await import('./org-budget.card');
    render(<OrgBudgetCard />, { wrapper });

    await screen.findByPlaceholderText('e.g. 100');
    fireEvent.click(screen.getByText('Save budget'));

    await waitFor(() => expect(mockToasterShow).toHaveBeenCalledWith(expect.any(String), 'warning'));
    expect(mockToasterShow).not.toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('disables the fields and Save once permissions resolve without settings:update', async () => {
    mockHasPermission.mockReturnValue(false);
    const { OrgBudgetCard } = await import('./org-budget.card');
    render(<OrgBudgetCard />, { wrapper });

    const monthly = (await screen.findByPlaceholderText('e.g. 100')) as HTMLInputElement;
    expect(monthly.disabled).toBe(true);
    expect((screen.getByText('Save budget').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('stays editable while permissions are still loading (optimistic render)', async () => {
    permissionsResolved = false;
    mockHasPermission.mockReturnValue(false);
    const { OrgBudgetCard } = await import('./org-budget.card');
    render(<OrgBudgetCard />, { wrapper });

    const monthly = (await screen.findByPlaceholderText('e.g. 100')) as HTMLInputElement;
    expect(monthly.disabled).toBe(false);
  });
});

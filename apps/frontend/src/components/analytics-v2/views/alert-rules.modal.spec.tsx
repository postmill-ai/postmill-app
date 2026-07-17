import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockT } = vi.hoisted(() => ({ mockT: vi.fn() }));
// Default: return the English fallback (with {{var}} interpolation).
const defaultT = (_k: string, d: string, vars?: Record<string, unknown>) =>
  vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d;
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

const mockToasterShow = vi.fn();
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

const mockUseIntegrationList = vi.fn();
vi.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => mockUseIntegrationList(),
}));

vi.mock('@gitroom/frontend/components/launches/calendar.context', () => ({}));

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockMutate = vi.fn();
const mockUseAlertRules = vi.fn();
vi.mock('../hooks/useAlertRules', () => ({
  useAlertRules: () => mockUseAlertRules(),
}));

import { AlertRulesModal } from './alert-rules.modal';

const INTEGRATIONS = [
  { id: 'i1', name: 'Insta', identifier: 'instagram', picture: null },
  { id: 'i2', name: 'My X', identifier: 'x', picture: null },
];

const RULE = {
  id: 'r1',
  integrationId: 'i1',
  metric: 'followers',
  comparator: 'gte' as const,
  threshold: 1000,
  direction: 'up' as const,
  enabled: true,
  lastFiredAt: null,
};

function stub(over: any = {}) {
  mockUseAlertRules.mockReturnValue({
    data: [],
    isLoading: false,
    error: undefined,
    mutate: mockMutate,
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemove,
    ...over,
  });
}

// selects render in order: channel, metric, comparator, direction
const selects = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('select')) as HTMLSelectElement[];

describe('AlertRulesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockT.mockImplementation(defaultT);
    mockUseIntegrationList.mockReturnValue({ data: INTEGRATIONS });
  });

  it('renders the loading skeleton', () => {
    stub({ isLoading: true });
    const { container } = render(<AlertRulesModal />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the error state and retries via mutate', () => {
    stub({ error: new Error('boom') });
    render(<AlertRulesModal />);
    expect(screen.getByText(/Failed to load alert rules/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Try again/i));
    expect(mockMutate).toHaveBeenCalled();
  });

  it('renders the empty state when there are no rules', () => {
    stub({ data: [] });
    render(<AlertRulesModal />);
    expect(screen.getByText(/No alert rules yet/i)).toBeTruthy();
    // form still shows the "New rule" header
    expect(screen.getByText('New rule')).toBeTruthy();
  });

  it('renders a rule row with channel name, metric, condition and direction', () => {
    stub({ data: [RULE] });
    render(<AlertRulesModal />);
    expect(screen.getByText(/Insta · Followers/)).toBeTruthy();
    // comparator fallback + direction also appear as <option>s, so match ≥1
    expect(screen.getAllByText(/is at or above/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/increase/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Enabled' })).toBeTruthy();
  });

  it('translates the comparator label in the rules list, not the raw fallback (6.6)', () => {
    // Translate only the gte comparator key; everything else keeps its fallback.
    mockT.mockImplementation((k: string, d: string) =>
      k === 'alert_cmp_gte' ? 'AT_OR_ABOVE_XLATED' : d
    );
    stub({ data: [RULE] }); // RULE.comparator === 'gte'
    render(<AlertRulesModal />);
    // The list row shows the translated label...
    expect(screen.getAllByText(/AT_OR_ABOVE_XLATED/).length).toBeGreaterThan(0);
    // ...and the raw English fallback is no longer rendered anywhere.
    expect(screen.queryByText(/is at or above/)).toBeNull();
  });

  it('labels a null-integration rule as "Any channel" and % for change_pct', () => {
    stub({
      data: [
        {
          ...RULE,
          id: 'r2',
          integrationId: null,
          comparator: 'change_pct',
          direction: 'down',
          enabled: false,
        },
      ],
    });
    render(<AlertRulesModal />);
    expect(screen.getByText(/Any channel · Followers/)).toBeTruthy();
    expect(screen.getAllByText(/changes % week-over-week/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/decrease/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeTruthy();
  });

  it('toggles a rule enabled state via update', async () => {
    stub({ data: [RULE] });
    mockUpdate.mockResolvedValue(undefined);
    render(<AlertRulesModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('r1', { enabled: false }));
  });

  it('toasts a warning when toggle fails', async () => {
    stub({ data: [RULE] });
    mockUpdate.mockRejectedValue(new Error('x'));
    render(<AlertRulesModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }));
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Failed to save alert rule', 'warning')
    );
  });

  it('deletes a rule and toasts success', async () => {
    stub({ data: [RULE] });
    mockRemove.mockResolvedValue(undefined);
    render(<AlertRulesModal />);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('r1'));
    expect(mockToasterShow).toHaveBeenCalledWith('Alert rule deleted', 'success');
  });

  it('toasts a warning when delete fails', async () => {
    stub({ data: [RULE] });
    mockRemove.mockRejectedValue(new Error('x'));
    render(<AlertRulesModal />);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Failed to delete alert rule', 'warning')
    );
  });

  it('enters edit mode, populating the form and switching the header/buttons', () => {
    stub({ data: [RULE] });
    const { container } = render(<AlertRulesModal />);
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByText('Edit rule')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    // form seeded from the rule
    expect(selects(container)[0].value).toBe('i1');
    expect(selects(container)[1].value).toBe('followers');
    const threshold = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(threshold.value).toBe('1000');
  });

  it('cancels edit mode back to the "New rule" form', () => {
    stub({ data: [RULE] });
    render(<AlertRulesModal />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('New rule')).toBeTruthy();
    expect(screen.queryByText('Cancel')).toBeFalsy();
  });

  it('updates an existing rule on submit in edit mode', async () => {
    stub({ data: [RULE] });
    mockUpdate.mockResolvedValue(undefined);
    render(<AlertRulesModal />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0]).toBe('r1');
    expect(mockToasterShow).toHaveBeenCalledWith('Alert rule saved', 'success');
    // resets back to New rule after save
    expect(screen.getByText('New rule')).toBeTruthy();
  });

  it('resets an in-progress edit when its rule is deleted', async () => {
    stub({ data: [RULE] });
    mockRemove.mockResolvedValue(undefined);
    render(<AlertRulesModal />);
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByText('Edit rule')).toBeTruthy();
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(screen.getByText('New rule')).toBeTruthy());
  });

  it('edits every form field and creates a new rule from them', async () => {
    stub({ data: [] });
    mockCreate.mockResolvedValue(undefined);
    const { container } = render(<AlertRulesModal />);

    fireEvent.change(selects(container)[0], { target: { value: 'i2' } }); // channel
    fireEvent.change(selects(container)[1], { target: { value: 'likes' } }); // metric
    fireEvent.change(selects(container)[2], { target: { value: 'change_pct' } }); // comparator
    fireEvent.change(container.querySelector('input[type="number"]')!, {
      target: { value: '55' },
    }); // threshold
    fireEvent.change(selects(container)[3], { target: { value: 'down' } }); // direction
    fireEvent.click(container.querySelector('input[type="checkbox"]')!); // enabled -> false

    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledWith({
      integrationId: 'i2',
      metric: 'likes',
      comparator: 'change_pct',
      threshold: 55,
      direction: 'down',
      enabled: false,
    });
    expect(mockToasterShow).toHaveBeenCalledWith('Alert rule created', 'success');
  });

  it('resets the channel back to null when "Any channel" is chosen', async () => {
    stub({ data: [] });
    mockCreate.mockResolvedValue(undefined);
    const { container } = render(<AlertRulesModal />);
    fireEvent.change(selects(container)[0], { target: { value: 'i1' } });
    fireEvent.change(selects(container)[0], { target: { value: '' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0].integrationId).toBeNull();
  });

  it('toasts a warning when create fails', async () => {
    stub({ data: [] });
    mockCreate.mockRejectedValue(new Error('nope'));
    render(<AlertRulesModal />);
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(mockToasterShow).toHaveBeenCalledWith('Failed to save alert rule', 'warning')
    );
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShareDialog } from './share-dialog';
import {
  clientDesignShareUrl,
  designShareUrl,
  designViewUrl,
} from './design-sharing';

const shareHook = vi.hoisted(() => ({
  state: {
    data: null as any,
    error: undefined as any,
    isLoading: false,
    mutate: vi.fn(),
  },
}));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, any>) =>
    Object.entries(params || {}).filter(([key]) => key !== 'interpolation').reduce(
      (text, [key, value]) => text.replaceAll(
        `{{${key}}}`,
        params?.interpolation?.escapeValue === false
          ? String(value)
          : String(value).replaceAll('&', '&amp;').replaceAll("'", '&#39;'),
      ),
      fallback,
    ),
  useTranslationSettings: () => ({ resolvedLanguage: 'en' }),
}));

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

vi.mock('./design-sharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./design-sharing')>()),
  useDesignShare: () => shareHook.state,
}));

const existingShare = (overrides: Record<string, unknown> = {}) => ({
  token: 'client-token',
  enabled: true,
  commentsEnabled: true,
  expiresAt: '2027-01-15T23:59:59.000Z',
  approvedAt: null,
  approvedBy: null,
  comments: [],
  ...overrides,
});

const renderDialog = (onToggleCollaboration = vi.fn()) => {
  render(
    <ShareDialog
      designId="design-123"
      initialCollabEnabled={false}
      connectedCount={0}
      onToggleCollaboration={onToggleCollaboration}
    />,
  );
  return onToggleCollaboration;
};

describe('design sharing', () => {
  beforeEach(() => {
    shareHook.state.data = null;
    shareHook.state.error = undefined;
    shareHook.state.isLoading = false;
    shareHook.state.mutate = vi.fn();
    fetchMock.mockReset();
  });

  it('builds separate edit, view, and client links', () => {
    expect(designShareUrl('design-123', 'https://app.postmill.ai'))
      .toBe('https://app.postmill.ai/media/designer?designId=design-123');
    expect(designViewUrl('design-123', 'https://app.postmill.ai'))
      .toBe('https://app.postmill.ai/media/designer/view?designId=design-123');
    expect(clientDesignShareUrl('client token', 'https://app.postmill.ai'))
      .toBe('https://app.postmill.ai/share/design/client%20token');
  });

  it('copies the edit link and controls collaboration', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onToggleCollaboration = renderDialog();

    const input = screen.getByLabelText('Team link');
    expect(input).toHaveProperty('value', 'http://localhost:3000/media/designer?designId=design-123');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/media/designer?designId=design-123');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Enable collaboration' }));
    expect(onToggleCollaboration).toHaveBeenCalledWith(true);
    expect(screen.getByText('0 connected')).toBeTruthy();
    expect(screen.getByText(/team members with Can edit can see each other’s cursors/)).toBeTruthy();
  });

  it('switches the team link to the read-only preview route', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Team access'), { target: { value: 'view' } });
    expect(screen.getByLabelText('Team link')).toHaveProperty(
      'value',
      'http://localhost:3000/media/designer/view?designId=design-123',
    );
    expect(screen.getByText(/read-only preview; it does not restrict teammates who can edit/)).toBeTruthy();
  });

  it('creates a client link with comments and expiry', async () => {
    const saved = existingShare();
    fetchMock.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(saved) });
    renderDialog();

    fireEvent.click(screen.getByText('Allow client comments').parentElement!.firstElementChild!);
    fireEvent.click(screen.getByRole('button', { name: 'Enable client link' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/media/designs/design-123/share', {
      method: 'PUT',
      body: expect.any(String),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.enabled).toBe(true);
    expect(body.commentsEnabled).toBe(true);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(shareHook.state.mutate).toHaveBeenCalledWith(saved, { revalidate: false });
  });

  it('shows and disables an existing client link', async () => {
    shareHook.state.data = existingShare({
      approvedAt: '2026-11-18T12:00:00.000Z',
      approvedBy: "O'Brien & Co",
      comments: [{ id: 'c1', authorName: 'Acme client', content: 'Looks good', createdAt: '2026-11-18T11:00:00.000Z' }],
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(existingShare({ enabled: false })),
    });
    renderDialog();

    expect(screen.getByLabelText('Client preview link')).toHaveProperty(
      'value',
      'http://localhost:3000/share/design/client-token',
    );
    expect(screen.getByText("Approved by O'Brien & Co on Nov 18, 2026.")).toBeTruthy();
    expect(screen.getByText('Looks good')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disable link' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/media/designs/design-123/share', { method: 'DELETE' }));
  });

  it('keeps team sharing usable when client-share management is forbidden', () => {
    shareHook.state.error = new Error('Forbidden');
    renderDialog();
    expect(screen.getByLabelText('Team link')).toBeTruthy();
    expect(screen.getByText('Client sharing settings are unavailable for your role.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enable client link' })).toBeNull();
  });
});

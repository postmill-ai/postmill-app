import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { DataExportTab } from './data-export.tab';

const fetchMock = vi.fn();
let role = 'owner';
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ isResolved: true, role }),
}));
vi.mock('@postmill-ai/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: 'https://api.example.test/' }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@postmill-ai/react/helpers/utc.date.render', () => ({
  UtcToLocalDateRender: ({ date }: { date: string }) => date,
}));

const completedJob = {
  id: 'job-1',
  kind: 'export',
  status: 'completed',
  archiveSha256: 'abc',
  expiresAt: '2026-11-09T00:00:00.000Z',
  createdAt: '2026-11-08T00:00:00.000Z',
};
const response = (body: unknown, ok = true) => ({ ok, json: vi.fn(async () => body) });

const renderTab = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DataExportTab />
  </SWRConfig>,
);

beforeEach(() => {
  role = 'owner';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
    if (url === '/org-portability/jobs') return response([completedJob]);
    if (url === '/org-portability/exports') return response({ ...completedJob, status: 'pending' });
    if (url === '/org-portability/jobs/job-1/download' && options?.method === 'POST') {
      return response({ url: '/org-portability/download/one-time-token' });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
});

afterEach(cleanup);

describe('DataExportTab', () => {
  it('creates an export and issues a one-time download link', async () => {
    renderTab();
    expect(await screen.findByRole('button', { name: 'Create download link' })).toBeTruthy();
    fireEvent.change((document.querySelector('input[name="passphrase"]') as HTMLInputElement), { target: { value: 'long enough passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization export' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/org-portability/exports', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ passphrase: 'long enough passphrase' }),
    })));
    expect((document.querySelector('input[name="passphrase"]') as HTMLInputElement)).toHaveProperty('value', '');

    fireEvent.click(screen.getByRole('button', { name: 'Create download link' }));
    expect(await screen.findByRole('link', { name: 'Download archive' })).toHaveProperty(
      'href',
      'https://api.example.test/org-portability/download/one-time-token',
    );
  });

  it('hides the export workflow from non-owners without fetching jobs', async () => {
    role = 'admin';
    renderTab();
    expect(await screen.findByText('Only an organization owner can export organization data.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create organization export' })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

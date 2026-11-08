import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mockFetch = vi.fn();
const mockReplace = vi.fn();
const mockMutate = vi.fn(async () => undefined);
let polledJob: any = null;

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback || _key,
}));
vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ isResolved: true, isOwner: true, isSuperAdmin: false }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
vi.mock('swr', () => ({
  default: () => ({ data: polledJob }),
  useSWRConfig: () => ({ mutate: mockMutate }),
}));

import { StepImport } from './step-import';

const jsonResponse = (body: any, ok = true) => ({ ok, json: async () => body }) as Response;

describe('StepImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    polledJob = null;
    mockFetch.mockImplementation(async (url: string, options?: any) => {
      if (url === '/org-portability/import-uploads') {
        return jsonResponse({ id: 'job-1', status: 'uploading' });
      }
      if (url.endsWith('/chunks')) {
        const body = JSON.parse(options.body);
        return jsonResponse({ uploadedBytes: body.offset + Buffer.from(body.data, 'base64').length });
      }
      if (url.endsWith('/validate')) {
        polledJob = {
          id: 'job-1',
          status: 'ready',
          progress: { source: { name: 'Source Org' }, createdAt: new Date().toISOString(), missingAssets: 1 },
        };
        return jsonResponse({ id: 'job-1', status: 'validating' });
      }
      if (url.endsWith('/commit')) return jsonResponse({ id: 'job-1', status: 'pending' });
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  it('uploads sequential chunks, verifies, then starts the background import', async () => {
    render(<StepImport />);
    const file = new File([new Uint8Array(8 * 1024 * 1024 + 32)], 'organization.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('Organization export (.zip)'), { target: { files: [file] } });
    fireEvent.change(screen.getByPlaceholderText('At least 12 characters'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and verify archive' }));

    await screen.findByText('Archive verified: Source Org');
    const chunkCalls = mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/chunks'));
    expect(chunkCalls).toHaveLength(2);
    const first = JSON.parse(chunkCalls[0][1].body);
    const second = JSON.parse(chunkCalls[1][1].body);
    expect(first.offset).toBe(0);
    expect(second.offset).toBe(8 * 1024 * 1024);
    expect(Buffer.from(second.data, 'base64')).toHaveLength(32);
    expect(JSON.stringify(first)).not.toContain('correct horse');

    fireEvent.click(screen.getByRole('button', { name: 'Import organization' }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/org-portability/import-uploads/job-1/commit', {
        method: 'POST',
        body: JSON.stringify({ passphrase: 'correct horse battery' }),
      });
    });
  });

  it('shows validation errors without starting the import', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/org-portability/import-uploads') return jsonResponse({ id: 'job-1', status: 'uploading' });
      if (url.endsWith('/chunks')) return jsonResponse({ uploadedBytes: 4 });
      if (url.endsWith('/validate')) return jsonResponse({ message: 'Archive passphrase is incorrect.' }, false);
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<StepImport />);
    fireEvent.change(screen.getByLabelText('Organization export (.zip)'), {
      target: { files: [new File(['zip'], 'organization.zip')] },
    });
    fireEvent.change(screen.getByPlaceholderText('At least 12 characters'), { target: { value: 'wrong passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and verify archive' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('passphrase is incorrect');
    expect(screen.queryByRole('button', { name: 'Import organization' })).toBeNull();
  });

  it('redirects after the background job completes', async () => {
    render(<StepImport />);
    fireEvent.change(screen.getByLabelText('Organization export (.zip)'), {
      target: { files: [new File(['zip'], 'organization.zip')] },
    });
    fireEvent.change(screen.getByPlaceholderText('At least 12 characters'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and verify archive' }));
    await screen.findByText('Archive verified: Source Org');

    polledJob = { id: 'job-1', status: 'completed' };
    fireEvent.click(screen.getByRole('button', { name: 'Import organization' }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockMutate).toHaveBeenCalledWith('/user/self', expect.any(Function), { revalidate: true });
  });
});

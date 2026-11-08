import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';

const mockFetch = vi.fn();
const mockReplace = vi.fn();
const mockMutate = vi.fn(async () => undefined);

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

import { StepImport } from './step-import';

const jsonResponse = (body: any, ok = true) => ({ ok, json: async () => body }) as Response;

describe('StepImport with real SWR caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let server: any = null;
    let validationAttempt = 0;
    let validationGets = 0;
    let commitGets = 0;
    const polledStatuses: string[] = [];
    (mockFetch as any).polledStatuses = polledStatuses;

    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/org-portability/import-uploads') {
        server = { id: 'job-1', status: 'uploading', progress: { uploadedBytes: 0 } };
        return jsonResponse(server);
      }
      if (url.endsWith('/chunks')) {
        server = { ...server, progress: { uploadedBytes: 3 } };
        return jsonResponse({ uploadedBytes: 3 });
      }
      if (url.endsWith('/validate')) {
        validationAttempt++;
        validationGets = 0;
        server = { id: 'job-1', status: 'validating', progress: { uploadedBytes: 3 } };
        return jsonResponse(server);
      }
      if (url.endsWith('/commit')) {
        commitGets = 0;
        server = { id: 'job-1', status: 'processing', progress: {} };
        return jsonResponse({ id: 'job-1', status: 'pending', progress: {} });
      }
      if (url.startsWith('/org-portability/import-uploads/job-1?')) {
        if (server.status === 'validating') {
          validationGets++;
          if (validationGets >= 2) {
            server = validationAttempt === 1 ? {
              id: 'job-1',
              status: 'uploading',
              progress: { uploadedBytes: 3 },
              error: 'Temporary validation failure',
            } : {
              id: 'job-1',
              status: 'ready',
              progress: {
                source: { name: 'Source Org' },
                createdAt: '2026-11-08T00:00:00Z',
                missingAssets: 0,
              },
            };
          }
        } else if (server.status === 'processing') {
          commitGets++;
          if (commitGets >= 2) server = { id: 'job-1', status: 'completed', progress: {} };
        }
        polledStatuses.push(server.status);
        return jsonResponse({ ...server });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  it('retries validation and completes the import without stale cached jobs taking over', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), isVisible: () => true, isOnline: () => true }}>
        <StepImport />
      </SWRConfig>,
    );
    fireEvent.change(screen.getByLabelText('Organization export (.zip)'), {
      target: { files: [new File(['zip'], 'organization.zip')] },
    });
    fireEvent.change(screen.getByPlaceholderText('At least 12 characters'), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and verify archive' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Retry verification' }, { timeout: 10_000 }));
    await screen.findByText('Archive verified: Source Org', {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Import organization' }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'), { timeout: 10_000 });
    expect((mockFetch as any).polledStatuses).toEqual([
      'validating',
      'uploading',
      'validating',
      'ready',
      'processing',
      'completed',
    ]);
  }, 30_000);
});

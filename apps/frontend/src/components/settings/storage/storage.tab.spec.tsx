import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SWRConfig } from 'swr';
import React from 'react';

const mockToasterShow = vi.fn();

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mockToasterShow }),
}));

const mockDeleteDialog = vi.fn().mockResolvedValue(false);

vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: mockDeleteDialog,
}));

vi.mock('@gitroom/frontend/components/settings/storage/provider-form.modal', () => ({
  ProviderFormModal: () => null,
}));

vi.mock('@gitroom/frontend/components/settings/storage/migration.modal', () => ({
  MigrationModal: () => null,
}));

vi.mock('@gitroom/frontend/components/settings/storage/audit.tab', () => ({
  AuditTab: () => null,
}));

// storage.tab reads the kernel provider catalog to surface version status;
// mock it to an empty catalog (mirrors shortlinks/vpn specs).
vi.mock('@gitroom/frontend/components/settings/shared/use-provider-catalog', () => ({
  useProviderCatalog: () => ({ data: [] }),
}));

type MockProvider = {
  id: string;
  type: string;
  name: string;
  mounted: boolean;
  quotaBytes: string | null;
  bucket: string | null;
  region: string | null;
};

type MockUsage = {
  providers: Array<{ id: string; name: string; usageBytes: number | null }>;
};

type MockQuotaStatus = {
  usedBytes: number;
  quotaBytes: number;
  percentUsed: number;
  warning: boolean;
} | null;

type MockUsageBreakdown = {
  byFolder: Array<{ folderId: string; folderName: string; totalBytes: number }>;
  byProvider: Array<{ providerId: string; providerName: string; totalBytes: number }>;
} | null;

let mockProviders: MockProvider[] = [];
let mockUsage: MockUsage = { providers: [] };
let mockQuotaStatus: MockQuotaStatus = null;
let mockUsageBreakdown: MockUsageBreakdown = null;

const mockFetchFn = vi.fn(async (url: string) => {
  if (url === '/settings/storage') {
    return { ok: true, json: () => Promise.resolve(mockProviders) };
  }
  if (typeof url === 'string' && url.startsWith('/settings/storage/usage-breakdown')) {
    return { ok: true, json: () => Promise.resolve(mockUsageBreakdown) };
  }
  if (typeof url === 'string' && url.startsWith('/settings/storage/usage')) {
    return { ok: true, json: () => Promise.resolve(mockUsage) };
  }
  if (typeof url === 'string' && url.startsWith('/settings/storage/quota-status')) {
    return { ok: true, json: () => Promise.resolve(mockQuotaStatus) };
  }
  return { ok: true, json: () => Promise.resolve({}) };
});

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

const localProvider = {
  id: 'local-1',
  type: 'LOCAL',
  name: 'Local Storage',
  mounted: true,
  quotaBytes: null,
  bucket: null,
  region: null,
};

const s3Provider = {
  id: 's3-1',
  type: 'S3',
  name: 'AWS S3 Provider',
  mounted: true,
  quotaBytes: '10737418240',
  bucket: 'my-bucket',
  region: 'us-east-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockProviders = [];
  mockUsage = { providers: [] };
  mockQuotaStatus = null;
  mockUsageBreakdown = null;
});

function renderWithSWR(ui: React.ReactElement) {
  return render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      {ui}
    </SWRConfig>
  );
}

describe('StorageTab', () => {
  describe('provider list (ProviderListShell)', () => {
    it('renders the "Storage Providers" heading and the always-on LOCAL card', async () => {
      mockProviders = [localProvider, s3Provider];

      const { StorageTab } = await import('./storage.tab');
      renderWithSWR(<StorageTab />);

      await waitFor(() => {
        expect(screen.getByText('Storage Providers')).toBeDefined();
        // LOCAL provider surfaces as the "Postmill Storage" card.
        expect(screen.getByText('Postmill Storage')).toBeDefined();
      });
    });

    it('renders a configured non-LOCAL provider by name with an Unmount action when mounted', async () => {
      mockProviders = [localProvider, s3Provider];

      const { StorageTab } = await import('./storage.tab');
      renderWithSWR(<StorageTab />);

      await waitFor(() => {
        expect(screen.getByText('AWS S3 Provider')).toBeDefined();
        expect(screen.getByText('Unmount')).toBeDefined();
      });
    });

    it('shows a Mount action (the On/Off toggle) for an unmounted provider', async () => {
      mockProviders = [localProvider, { ...s3Provider, mounted: false }];

      const { StorageTab } = await import('./storage.tab');
      renderWithSWR(<StorageTab />);

      await waitFor(() => {
        expect(screen.getByText('AWS S3 Provider')).toBeDefined();
        expect(screen.getByText('Mount')).toBeDefined();
      });
      // No mounted instance, so no Unmount affordance.
      expect(screen.queryByText('Unmount')).toBeNull();
    });

    it('renders "Configure" template rows for cloud provider types', async () => {
      mockProviders = [localProvider];

      const { StorageTab } = await import('./storage.tab');
      renderWithSWR(<StorageTab />);

      await waitFor(() => {
        expect(screen.getByText('Storage Providers')).toBeDefined();
      });
      // Always-present "add another" template rows, one per cloud provider type.
      expect(screen.getAllByText('Configure').length).toBeGreaterThan(0);
      expect(screen.getByText('Cloudflare R2')).toBeDefined();
    });
  });

  describe('no Primary (multi-mount; Mount is the toggle)', () => {
    it('does not render a "Set Default" / "Make Primary" affordance', async () => {
      mockProviders = [localProvider, s3Provider];

      const { StorageTab } = await import('./storage.tab');
      renderWithSWR(<StorageTab />);

      await waitFor(() => {
        expect(screen.getByText('Storage Providers')).toBeDefined();
      });

      // Storage is intentionally multi-mount with no Primary (§1.4 / §3.1).
      expect(screen.queryByText('Set Default')).toBeNull();
      expect(screen.queryByText('Make Primary')).toBeNull();
    });
  });
});

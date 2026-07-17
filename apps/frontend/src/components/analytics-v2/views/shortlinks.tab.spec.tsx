import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockT = vi.fn((_key: string, fallback?: string, opts?: Record<string, any>) => {
  if (!fallback) return _key;
  if (opts?.count !== undefined) return fallback.replace('{{count}}', String(opts.count));
  return fallback;
});

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

let mockShortLinksData: any[] = [];
let mockTimeseriesData: any[] = [];
let mockLoading = false;
let mockError: Error | null = null;
let mockConfigData: any = null;

vi.mock('../kit/stat-tile', () => ({
  StatTile: ({ label, value }: { label: string; value: string }) => (
    <div data-testid="kpi-card">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

vi.mock('../hooks/useShortLinks', () => ({
  useShortLinks: () => ({
    data: mockShortLinksData,
    isLoading: mockLoading,
    error: mockError,
  }),
  useShortLinksTimeseries: () => ({
    data: mockTimeseriesData,
  }),
}));

vi.mock('@gitroom/frontend/components/settings/shortlinks/hooks/useShortlinksConfig', () => ({
  useShortlinksConfig: () => ({ data: mockConfigData }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

beforeEach(() => {
  vi.clearAllMocks();
  mockShortLinksData = [];
  mockTimeseriesData = [];
  mockLoading = false;
  mockError = null;
  mockConfigData = {
    active: {
      identifier: 'bitly',
      name: 'Bitly',
      capabilities: { create: true, statistics: true, customDomain: true },
    },
    providers: [],
  };
});

describe('Analytics ShortlinksTab', () => {
  describe('Loading State', () => {
    it('shows loading indicator when data is loading', async () => {
      mockLoading = true;

      const { ShortlinksTab } = await import('./shortlinks.tab');
      const { container } = render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(container.querySelector('.animate-pulse')).toBeTruthy();
    });
  });

  describe('Error State', () => {
    it('shows error message on fetch failure', async () => {
      mockError = new Error('Failed');

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(screen.getByText('Failed to load short links')).toBeDefined();
    });
  });

  describe('Empty State (U7)', () => {
    it('shows no-links message when provider has stats but no links', async () => {
      mockShortLinksData = [];
      mockConfigData = {
        active: {
          identifier: 'bitly',
          name: 'Bitly',
          capabilities: { create: true, statistics: true, customDomain: true },
        },
        providers: [],
      };

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(screen.getByText('No short links have been created yet.')).toBeDefined();
    });

    it('shows no-stats message when provider does not have statistics capability', async () => {
      mockShortLinksData = [];
      mockConfigData = {
        active: {
          identifier: 'tinyurl',
          name: 'TinyURL',
          capabilities: { create: true, statistics: false, customDomain: false },
        },
        providers: [],
      };

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(screen.getByText("Your active short-link provider doesn't expose click analytics.")).toBeDefined();
    });

    it('shows no-links message when config is null (no active provider)', async () => {
      mockShortLinksData = [];
      mockConfigData = null;

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(screen.getByText('No short links have been created yet.')).toBeDefined();
    });
  });

  describe('KPI Cards', () => {
    it('renders total clicks and total links KPI cards', async () => {
      mockShortLinksData = [
        { id: '1', shortUrl: 'https://short.ly/a', originalUrl: 'https://example.com/a', provider: 'bitly', clicks: 100, createdAt: '2026-01-01' },
        { id: '2', shortUrl: 'https://short.ly/b', originalUrl: 'https://example.com/b', provider: 'bitly', clicks: 50, createdAt: '2026-01-02' },
      ];
      mockTimeseriesData = [
        { date: '2026-01-01', clicks: 80 },
        { date: '2026-01-02', clicks: 70 },
      ];

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(screen.getByText('Total Clicks')).toBeDefined();
      expect(screen.getByText('Total Links')).toBeDefined();
      expect(screen.getByText('150')).toBeDefined();
      expect(screen.getByText('2')).toBeDefined();
    });
  });

  describe('Top Links Table (U8)', () => {
    it('renders top links table with headers', async () => {
      mockShortLinksData = [
        { id: '1', shortUrl: 'https://short.ly/a', originalUrl: 'https://example.com/page', provider: 'bitly', clicks: 42, createdAt: '2026-01-01' },
      ];

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(screen.getByText('Top Links')).toBeDefined();
      expect(screen.getByText('Short URL')).toBeDefined();
      expect(screen.getByText('Original URL')).toBeDefined();
      expect(screen.getByText('Clicks')).toBeDefined();
    });

    it('renders link rows with click counts', async () => {
      mockShortLinksData = [
        { id: '1', shortUrl: 'https://short.ly/x', originalUrl: 'https://example.com/x', provider: 'bitly', clicks: 99, createdAt: '2026-01-01' },
        { id: '2', shortUrl: 'https://short.ly/y', originalUrl: 'https://example.com/y', provider: 'bitly', clicks: 10, createdAt: '2026-01-02' },
      ];

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(screen.getByText('https://short.ly/x')).toBeDefined();
      expect(screen.getByText('https://example.com/x')).toBeDefined();
      expect(screen.getByText('99')).toBeDefined();
      expect(screen.getByText('https://short.ly/y')).toBeDefined();
      expect(screen.getByText('10')).toBeDefined();
    });

    it('does not mutate the original source array', async () => {
      const original = [
        { id: '1', shortUrl: 'https://short.ly/a', originalUrl: 'https://example.com/a', provider: 'bitly', clicks: 10, createdAt: '2026-01-01' },
        { id: '2', shortUrl: 'https://short.ly/b', originalUrl: 'https://example.com/b', provider: 'bitly', clicks: 100, createdAt: '2026-01-02' },
      ];
      mockShortLinksData = original;

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(original[0].clicks).toBe(10);
      expect(original[1].clicks).toBe(100);
    });

    it('shows Top 50 of N label when more than 50 links exist', async () => {
      mockShortLinksData = Array.from({ length: 60 }, (_, i) => ({
        id: String(i),
        shortUrl: `https://short.ly/${i}`,
        originalUrl: `https://example.com/${i}`,
        provider: 'bitly',
        clicks: i,
        createdAt: '2026-01-01',
      }));
      mockTimeseriesData = [];

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(screen.getByText('Top 50 of 60')).toBeDefined();
    });

    it('does not show Top 50 label when 50 or fewer links exist', async () => {
      mockShortLinksData = Array.from({ length: 50 }, (_, i) => ({
        id: String(i),
        shortUrl: `https://short.ly/${i}`,
        originalUrl: `https://example.com/${i}`,
        provider: 'bitly',
        clicks: i,
        createdAt: '2026-01-01',
      }));

      const { ShortlinksTab } = await import('./shortlinks.tab');
      render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      expect(screen.queryByText(/Top 50 of/)).toBeFalsy();
    });

    it('adds title attribute to original URL cell', async () => {
      mockShortLinksData = [
        { id: '1', shortUrl: 'https://short.ly/a', originalUrl: 'https://example.com/very-long-url', provider: 'bitly', clicks: 42, createdAt: '2026-01-01' },
      ];

      const { ShortlinksTab } = await import('./shortlinks.tab');
      const { container } = render(<ShortlinksTab from="2026-01-01" to="2026-01-31" />, { wrapper });

      const originalUrlCell = container.querySelector('td[title="https://example.com/very-long-url"]');
      expect(originalUrlCell).toBeDefined();
    });
  });
});

import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const mockFetch = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useShortlinksConfig', () => {
  it('returns config data from the SWR hook', async () => {
    const { useShortlinksConfig } = await import('./useShortlinksConfig');

    const mockData = {
      active: {
        identifier: 'bitly',
        name: 'Bitly',
        capabilities: { create: true, expand: true, statistics: true, bulkStatistics: true, customDomain: true },
        customDomain: 'link.mydomain.com',
      },
      providers: [
        {
          identifier: 'bitly',
          name: 'Bitly',
          capabilities: { create: true, expand: true, statistics: true, bulkStatistics: true, customDomain: true },
          credentialFields: [{ key: 'accessToken', label: 'Access Token', type: 'password', required: true }],
          authType: 'oauth2',
          defaultDomain: 'bit.ly',
          enabled: true,
          isActive: true,
          isConfigured: true,
          customDomain: 'link.mydomain.com',
        },
        {
          identifier: 'tinyurl',
          name: 'TinyURL',
          capabilities: { create: true, expand: false, statistics: false, bulkStatistics: false, customDomain: false },
          credentialFields: [{ key: 'apiToken', label: 'API Token', type: 'password', required: true }],
          authType: 'apiKey',
          enabled: false,
          isActive: false,
          isConfigured: false,
          customDomain: '',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useShortlinksConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockData);
    });

    expect(mockFetch).toHaveBeenCalledWith('/settings/shortlinks/config');
  });

  it('handles fetch error', async () => {
    const { useShortlinksConfig } = await import('./useShortlinksConfig');

    mockFetch.mockResolvedValueOnce({
      ok: false,
    });

    const { result } = renderHook(() => useShortlinksConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
  });
});

describe('useShortlinksProviders', () => {
  it('returns providers list from the SWR hook', async () => {
    const { useShortlinksProviders } = await import('./useShortlinksConfig');

    const mockData = [
      {
        identifier: 'bitly',
        name: 'Bitly',
        capabilities: { create: true, expand: true, statistics: true, bulkStatistics: true, customDomain: true },
        credentialFields: [{ key: 'accessToken', label: 'Access Token', type: 'password', required: true }],
        authType: 'oauth2',
        defaultDomain: 'bit.ly',
      },
      {
        identifier: 'tinyurl',
        name: 'TinyURL',
        capabilities: { create: true, expand: false, statistics: false, bulkStatistics: false, customDomain: false },
        credentialFields: [{ key: 'apiToken', label: 'API Token', type: 'password', required: true }],
        authType: 'apiKey',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useShortlinksProviders(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockData);
    });

    expect(mockFetch).toHaveBeenCalledWith('/settings/shortlinks/providers');
  });

  it('handles fetch error', async () => {
    const { useShortlinksProviders } = await import('./useShortlinksConfig');

    mockFetch.mockResolvedValueOnce({
      ok: false,
    });

    const { result } = renderHook(() => useShortlinksProviders(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
  });
});

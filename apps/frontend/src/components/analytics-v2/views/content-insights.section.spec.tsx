import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_k: string, d: string, vars?: Record<string, unknown>) =>
      vars ? d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k])) : d,
}));

const mockUseContentInsights = vi.fn();
vi.mock('../hooks/useContentInsights', () => ({
  useContentInsights: () => mockUseContentInsights(),
}));

import { ContentInsightsSection } from './content-insights.section';

function stub(over: any = {}) {
  mockUseContentInsights.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
    ...over,
  });
}

describe('ContentInsightsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the loading skeleton', () => {
    stub({ isLoading: true });
    const { container } = render(<ContentInsightsSection />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders an empty state for a zero-post org', () => {
    stub({ data: { findings: [], totalPosts: 0, orgMean: 0 } });
    render(<ContentInsightsSection />);
    expect(screen.getByText(/Not enough posts yet/i)).toBeTruthy();
  });

  it('renders ranked findings with sample size and a bucket deep-link', () => {
    stub({
      data: {
        totalPosts: 46,
        orgMean: 100,
        findings: [
          { label: 'Videos', bucket: 'video', dimension: 'mediaType', ratio: 2.3, sampleSize: 12 },
          { label: 'Images', bucket: 'image', dimension: 'mediaType', ratio: 0.8, sampleSize: 34 },
        ],
      },
    });
    render(<ContentInsightsSection />);
    expect(screen.getByText('Videos')).toBeTruthy();
    expect(screen.getByText('2.3×')).toBeTruthy();
    expect(screen.getByText(/based on 12 posts/i)).toBeTruthy();
    const link = screen.getByText('Videos').closest('a') as HTMLAnchorElement;
    // 6.5 — the link only switches to the posts tab; the mediaType/bucket filter
    // params were dropped (nothing consumed them).
    expect(link.getAttribute('href')).toContain('tab=posts');
    expect(link.getAttribute('href')).not.toContain('mediaType');
    expect(link.getAttribute('href')).not.toContain('bucket');
  });
});

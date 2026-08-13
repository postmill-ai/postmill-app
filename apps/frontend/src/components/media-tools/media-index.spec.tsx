import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars
      ? Object.entries(vars).reduce((s, [k, v]) => s.replace(`{{${k}}}`, String(v)), fallback)
      : fallback,
}));

let enabled: Set<string> | undefined = new Set<string>();
vi.mock('@postmill-ai/frontend/components/media-tools/use-enabled-media-providers', () => ({
  useEnabledMediaProviders: () => ({ data: enabled }),
}));

let canConfigure = true;
vi.mock('@postmill-ai/frontend/components/layout/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: () => canConfigure, isResolved: true }),
}));

import { MediaIndex } from './media-index';

const renderIndex = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MediaIndex />
    </SWRConfig>
  );

beforeEach(() => {
  enabled = new Set<string>();
  canConfigure = true;
});
afterEach(cleanup);

describe('MediaIndex hero', () => {
  it('always offers both ways to start, regardless of provider config', () => {
    renderIndex();

    expect(screen.getByText('Designer')).toBeTruthy();
    expect(screen.getByText('AI Designer')).toBeTruthy();
    expect(screen.getByText('Start from a canvas')).toBeTruthy();
    expect(screen.getByText('Start from a sentence')).toBeTruthy();
  });

  it('links the hero tiles at the two platform tools', () => {
    renderIndex();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/media/designer');
    expect(hrefs).toContain('/media/ai-designer');
  });

  it('always lists the stock libraries', () => {
    renderIndex();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/media/stock-photos');
    expect(hrefs).toContain('/media/stock-videos');
  });
});

describe('MediaIndex studios', () => {
  it('shows only studios whose provider is enabled', () => {
    enabled = new Set(['luma', 'openai']);
    renderIndex();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/media/luma');
    expect(hrefs).toContain('/media/openai');
    expect(hrefs).not.toContain('/media/runway');
  });

  it('resolves studios that ride another provider’s credentials', () => {
    // sora → openai, kling/pika → fal, google-ai → google.
    enabled = new Set(['openai']);
    renderIndex();
    let hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/media/sora');
    expect(hrefs).not.toContain('/media/kling');

    cleanup();
    enabled = new Set(['fal']);
    renderIndex();
    hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/media/kling');
    expect(hrefs).toContain('/media/pika');
    expect(hrefs).not.toContain('/media/sora');
  });

  it('renders capability chips from the studio badges', () => {
    enabled = new Set(['luma']);
    renderIndex();

    // Luma is Video + Image.
    expect(screen.getAllByText('Video').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Image').length).toBeGreaterThan(0);
  });

  it('hides the filter row when there are too few studios to be worth filtering', () => {
    enabled = new Set(['luma']);
    renderIndex();

    expect(screen.queryByRole('group', { name: 'Filter studios by output' })).toBeNull();
  });

  it('filters the grid by capability once there are enough studios', () => {
    enabled = new Set(['luma', 'openai', 'elevenlabs', 'runway', 'ideogram', 'suno']);
    renderIndex();

    const filters = screen.getByRole('group', { name: 'Filter studios by output' });
    expect(filters).toBeTruthy();

    const before = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(before).toContain('/media/elevenlabs');
    expect(before).toContain('/media/ideogram');

    // ElevenLabs is Voice + Audio; Ideogram is Image only.
    fireEvent.click(screen.getByRole('button', { name: 'Voice' }));

    const after = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(after).toContain('/media/elevenlabs');
    expect(after).not.toContain('/media/ideogram');
  });

  it('clears the filter when the active chip is clicked again', () => {
    enabled = new Set(['luma', 'openai', 'elevenlabs', 'runway', 'ideogram', 'suno']);
    renderIndex();

    const voice = screen.getByRole('button', { name: 'Voice' });
    fireEvent.click(voice);
    expect(voice.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(voice);

    expect(voice.getAttribute('aria-pressed')).toBe('false');
    expect(
      screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    ).toContain('/media/ideogram');
  });
});

describe('MediaIndex empty and loading states', () => {
  it('shows a skeleton while the enabled set is still unknown', () => {
    // Distinct from "none configured" — an empty Set is a real answer.
    enabled = undefined;
    const { container } = renderIndex();

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('No AI studios connected')).toBeNull();
  });

  it('explains what to do when nothing is configured', () => {
    enabled = new Set();
    renderIndex();

    expect(screen.getByText('No AI studios connected')).toBeTruthy();
    expect(
      screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    ).toContain('/settings/content/ai-media');
  });

  it('does not send a member to a settings page they cannot open', () => {
    // An empty Set is also what a `media:read`-only member gets, because
    // /settings/media/config 403s for them.
    enabled = new Set();
    canConfigure = false;
    renderIndex();

    expect(screen.getByText('No AI studios connected')).toBeTruthy();
    expect(
      screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    ).not.toContain('/settings/content/ai-media');
  });
});

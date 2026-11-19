import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignPreviewView } from './design-preview-view';
import { backendResourceUrl, formatDesignShareDate, type DesignPreviewData } from './design-sharing';

const imageMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
}));

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

vi.mock('@postmill-ai/frontend/components/ui/overflow-tabs', () => ({
  OverflowTabs: ({ items, onSelect }: any) => (
    <div>
      {items.map((item: any) => (
        <button key={item.key} type="button" onClick={() => onSelect(item.key)}>{item.label}</button>
      ))}
    </div>
  ),
}));

const preview = (overrides: Partial<DesignPreviewData> = {}): DesignPreviewData => ({
  name: 'Spring campaign',
  mode: 'image',
  outputs: [
    {
      outputIndex: 0,
      name: 'Square',
      width: 1080,
      height: 1080,
      pages: [{ pageNumber: 0, name: 'Page 1' }],
    },
    {
      outputIndex: 1,
      name: 'Wide',
      width: 1920,
      height: 1080,
      pages: [
        { pageNumber: 0, name: 'Cover' },
        { pageNumber: 1, name: 'Details' },
      ],
    },
  ],
  commentsEnabled: true,
  expiresAt: '2027-01-01T00:00:00.000Z',
  approvedAt: null,
  approvedBy: null,
  comments: [],
  ...overrides,
});

describe('DesignPreviewView', () => {
  beforeEach(() => {
    imageMocks.fetch.mockReset().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/png' })),
    });
    imageMocks.createObjectURL.mockReset().mockImplementation(() => `blob:preview-${imageMocks.createObjectURL.mock.calls.length}`);
    imageMocks.revokeObjectURL.mockReset();
    vi.stubGlobal('fetch', imageMocks.fetch);
    Object.defineProperty(URL, 'createObjectURL', { value: imageMocks.createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: imageMocks.revokeObjectURL, configurable: true });
  });

  it('renders server images and caches them across output and page navigation', async () => {
    render(<DesignPreviewView data={preview()} imageBaseUrl="https://api.test/team/preview" />);

    expect(await screen.findByRole('img')).toHaveProperty('src', 'blob:preview-1');
    expect(imageMocks.fetch).toHaveBeenCalledWith('https://api.test/team/preview/0/0', {
      credentials: 'include',
      signal: expect.any(AbortSignal),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
    await waitFor(() => expect(imageMocks.fetch).toHaveBeenCalledWith('https://api.test/team/preview/1/0', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    await waitFor(() => expect(imageMocks.fetch).toHaveBeenCalledWith('https://api.test/team/preview/1/1', expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'Cover' }));
    await waitFor(() => expect(imageMocks.createObjectURL).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByRole('button', { name: 'Square' }));
    await waitFor(() => expect(imageMocks.createObjectURL).toHaveBeenCalledTimes(5));
    for (const url of ['0/0', '1/0', '1/1']) {
      expect(imageMocks.fetch.mock.calls.filter(([requestUrl]) => requestUrl === `https://api.test/team/preview/${url}`)).toHaveLength(1);
    }
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByLabelText('Leave a comment')).toBeNull();
  });

  it('posts public comments and approval with the reviewer name', async () => {
    const onComment = vi.fn().mockResolvedValue(undefined);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <DesignPreviewView
        data={preview()}
        imageBaseUrl="/public/preview"
        publicMode
        onComment={onComment}
        onApprove={onApprove}
      />,
    );

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Acme client' } });
    fireEvent.change(screen.getByLabelText('Leave a comment'), { target: { value: 'Please use the blue logo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() => expect(onComment).toHaveBeenCalledWith('Acme client', 'Please use the blue logo'));

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith('Acme client'));
  });

  it('hides the comment form when comments are disabled but keeps approval available', async () => {
    render(
      <DesignPreviewView
        data={preview({ commentsEnabled: false })}
        imageBaseUrl="/public/preview"
        publicMode
        onApprove={vi.fn()}
      />,
    );
    await screen.findByRole('img');
    expect(screen.queryByLabelText('Leave a comment')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('retains feedback and allows comments after approval', async () => {
    render(
      <DesignPreviewView
        data={preview({
          approvedAt: '2026-11-18T00:00:00.000Z',
          approvedBy: 'Acme client',
          comments: [{ id: 'c1', authorName: 'Acme client', content: 'Approved with thanks', createdAt: '2026-11-18T00:00:00.000Z' }],
        })}
        imageBaseUrl="/public/preview"
        publicMode
        onComment={vi.fn()}
      />,
    );
    await screen.findByRole('img');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Approved with thanks')).toBeTruthy();
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(screen.getByLabelText('Leave a comment')).toBeTruthy();
  });

  it('preserves reviewer and design names without HTML entities', async () => {
    render(
      <DesignPreviewView
        data={preview({
          name: 'Smith & Co',
          approvedAt: '2026-11-18T00:00:00.000Z',
          approvedBy: "O'Brien & Co",
        })}
        imageBaseUrl="/public/preview"
        publicMode
      />,
    );
    expect(await screen.findByRole('img', { name: 'Smith & Co — Page 1', exact: true })).toBeTruthy();
    expect(screen.getByText(/^Approved by O'Brien & Co on .+\.$/)).toBeTruthy();
  });

  it('preserves backend paths for team and public image URLs', () => {
    expect(backendResourceUrl('http://localhost:4007/api', 'https://app.example', '/public/design-share/token/preview'))
      .toBe('http://localhost:4007/api/public/design-share/token/preview');
    expect(backendResourceUrl('http://localhost:4007/api', 'https://app.example', '/media/designs/design-1/preview'))
      .toBe('http://localhost:4007/api/media/designs/design-1/preview');
    expect(backendResourceUrl('https://api.postmill.ai', 'https://app.example', '/public/design-share/token/preview'))
      .toBe('https://api.postmill.ai/public/design-share/token/preview');
    expect(backendResourceUrl('', 'https://app.example', '/media/designs/design-1/preview'))
      .toBe('https://app.example/media/designs/design-1/preview');
  });

  it('formats dates for the active locale', () => {
    const value = '2026-11-18T00:00:00.000Z';
    expect(formatDesignShareDate(value, 'en')).toContain('2026');
    expect(formatDesignShareDate(value, 'fr')).not.toBe(formatDesignShareDate(value, 'en'));
  });

  it('shows a fallback and retries a failed render', async () => {
    imageMocks.fetch.mockResolvedValueOnce({ ok: false, status: 429 });
    render(<DesignPreviewView data={preview()} imageBaseUrl="/preview" />);
    expect(await screen.findByText('This preview image is unavailable.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('img')).toBeTruthy();
    expect(imageMocks.fetch.mock.calls.filter(([url]) => url === '/preview/0/0')).toHaveLength(2);
  });
});

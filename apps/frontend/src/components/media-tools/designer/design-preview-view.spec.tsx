import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DesignPreviewView } from './design-preview-view';
import type { DesignPreviewData } from './design-sharing';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, unknown>) =>
    Object.entries(params || {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback,
    ),
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
  beforeEach(() => vi.clearAllMocks());

  it('renders server images and navigates outputs and pages', () => {
    render(<DesignPreviewView data={preview()} imageBaseUrl="https://api.test/team/preview" />);

    expect(screen.getByRole('img')).toHaveProperty('src', 'https://api.test/team/preview/0/0');
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
    expect(screen.getByRole('img')).toHaveProperty('src', 'https://api.test/team/preview/1/0');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('img')).toHaveProperty('src', 'https://api.test/team/preview/1/1');
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

  it('hides the comment form when comments are disabled but keeps approval available', () => {
    render(
      <DesignPreviewView
        data={preview({ commentsEnabled: false })}
        imageBaseUrl="/public/preview"
        publicMode
        onApprove={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Leave a comment')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('retains feedback and allows comments after approval', () => {
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
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Approved with thanks')).toBeTruthy();
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(screen.getByLabelText('Leave a comment')).toBeTruthy();
  });

  it('shows a fallback when the rendered image cannot load', () => {
    render(<DesignPreviewView data={preview()} imageBaseUrl="/preview" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('This preview image is unavailable.')).toBeTruthy();
  });
});

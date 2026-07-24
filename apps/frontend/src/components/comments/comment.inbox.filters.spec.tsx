import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentInboxFilters, InboxFilters } from './comment.inbox.filters';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback: string) => fallback,
}));

describe('CommentInboxFilters', () => {
  let filters: InboxFilters;
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    filters = { unreadOnly: false };
    onChange = vi.fn();
  });

  it('renders sentiment and priority dropdowns', () => {
    render(<CommentInboxFilters filters={filters} onChange={onChange} />);

    expect(screen.getByText('All sentiments')).toBeTruthy();
    expect(screen.getByText('All priorities')).toBeTruthy();
  });

  it('emits sentiment filter changes', () => {
    render(<CommentInboxFilters filters={filters} onChange={onChange} />);

    const sentimentSelect = screen.getByDisplayValue('All sentiments');
    fireEvent.change(sentimentSelect, { target: { value: 'negative' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sentiment: 'negative' }),
    );
  });

  it('emits priority filter changes', () => {
    render(<CommentInboxFilters filters={filters} onChange={onChange} />);

    const prioritySelect = screen.getByDisplayValue('All priorities');
    fireEvent.change(prioritySelect, { target: { value: 'high' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'high' }),
    );
  });
});

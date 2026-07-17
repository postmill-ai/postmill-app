import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockFetchFn = vi.fn();

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetchFn,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { CommentComposer } from './comment.composer';

const defaultProps = {
  postId: 'post-1',
  onClose: vi.fn(),
  integrationName: 'Twitter',
  onSubmitted: vi.fn(),
};

describe('CommentComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function typeMessage(text: string) {
    const textarea = screen.getByLabelText('Reply');
    fireEvent.change(textarea, { target: { value: text } });
  }

  it('shows "Replying as {integrationName}" text', () => {
    render(<CommentComposer {...defaultProps} integrationName="Twitter" />);
    expect(screen.getByText('Replying as Twitter')).toBeTruthy();
  });

  it('shows different integration name', () => {
    render(<CommentComposer {...defaultProps} integrationName="Instagram" />);
    expect(screen.getByText('Replying as Instagram')).toBeTruthy();
  });

  it('submit button is disabled when message is empty', () => {
    render(<CommentComposer {...defaultProps} />);
    const sendButton = screen.getByText('Send');
    expect(sendButton.hasAttribute('disabled')).toBe(true);
  });

  it('submit button is disabled when message is only whitespace', () => {
    render(<CommentComposer {...defaultProps} />);
    typeMessage('   ');
    const sendButton = screen.getByText('Send');
    expect(sendButton.hasAttribute('disabled')).toBe(true);
  });

  it('submit button is enabled when message has content', () => {
    render(<CommentComposer {...defaultProps} />);
    typeMessage('Hello');
    const sendButton = screen.getByText('Send');
    expect(sendButton.hasAttribute('disabled')).toBe(false);
  });

  it('submit button shows "Sending..." when sending', async () => {
    mockFetchFn.mockReturnValueOnce(new Promise(() => {}));
    render(<CommentComposer {...defaultProps} />);
    typeMessage('Hello');
    await act(async () => {
      screen.getByText('Send').click();
    });
    expect(screen.getByText('Sending...')).toBeTruthy();
  });

  it('submit button is disabled when sending', async () => {
    mockFetchFn.mockReturnValueOnce(new Promise(() => {}));
    render(<CommentComposer {...defaultProps} />);
    typeMessage('Hello');
    await act(async () => {
      screen.getByText('Send').click();
    });
    expect(screen.getByText('Sending...').hasAttribute('disabled')).toBe(true);
  });

  it('calls POST /posts/:postId/social-comments for top-level reply', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    render(<CommentComposer {...defaultProps} />);
    typeMessage('Hello world');
    screen.getByText('Send').click();
    expect(mockFetchFn).toHaveBeenCalledWith(
      '/posts/post-1/social-comments',
      { method: 'POST', body: JSON.stringify({ message: 'Hello world' }) }
    );
  });

  it('calls POST /posts/:postId/social-comments/:commentId/reply when replyToCommentId is set', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    render(
      <CommentComposer {...defaultProps} replyToCommentId="c1" />
    );
    typeMessage('Reply text');
    screen.getByText('Send').click();
    expect(mockFetchFn).toHaveBeenCalledWith(
      '/posts/post-1/social-comments/c1/reply',
      { method: 'POST', body: JSON.stringify({ message: 'Reply text' }) }
    );
  });

  it('shows error message on API failure with response text', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve('Rate limit exceeded'),
    });
    render(<CommentComposer {...defaultProps} />);
    typeMessage('Hello');
    screen.getByText('Send').click();
    await vi.waitFor(() => {
      expect(screen.getByText('Rate limit exceeded')).toBeTruthy();
    });
  });

  it('shows fallback error message on API failure without response text', async () => {
    mockFetchFn.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve(''),
    });
    render(<CommentComposer {...defaultProps} />);
    typeMessage('Hello');
    screen.getByText('Send').click();
    await vi.waitFor(() => {
      expect(screen.getByText('Failed to send reply')).toBeTruthy();
    });
  });

  it('calls onSubmitted on success', async () => {
    const onSubmitted = vi.fn();
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    render(
      <CommentComposer {...defaultProps} onSubmitted={onSubmitted} />
    );
    typeMessage('Hello');
    screen.getByText('Send').click();
    await vi.waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledOnce();
    });
  });

  it('clears message after successful send', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    render(<CommentComposer {...defaultProps} />);
    typeMessage('Hello');
    screen.getByText('Send').click();
    await vi.waitFor(() => {
      const textarea = screen.getByLabelText('Reply') as HTMLTextAreaElement;
      expect(textarea.value).toBe('');
    });
  });

  it('does not call onSubmitted on API failure', async () => {
    const onSubmitted = vi.fn();
    mockFetchFn.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve('Error'),
    });
    render(
      <CommentComposer {...defaultProps} onSubmitted={onSubmitted} />
    );
    typeMessage('Hello');
    screen.getByText('Send').click();
    await vi.waitFor(() => {
      expect(screen.getByText('Error')).toBeTruthy();
    });
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('sends message on Cmd+Enter', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    render(<CommentComposer {...defaultProps} />);
    const textarea = screen.getByLabelText('Reply');
    fireChange(textarea, 'Hello');
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    await vi.waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/posts/post-1/social-comments',
        expect.any(Object)
      );
    });
  });

  it('sends message on Ctrl+Enter', async () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    render(<CommentComposer {...defaultProps} />);
    const textarea = screen.getByLabelText('Reply');
    fireChange(textarea, 'World');
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await vi.waitFor(() => {
      expect(mockFetchFn).toHaveBeenCalledWith(
        '/posts/post-1/social-comments',
        expect.any(Object)
      );
    });
  });

  it('does not send on plain Enter without meta or ctrl', () => {
    mockFetchFn.mockResolvedValueOnce({ ok: true });
    render(<CommentComposer {...defaultProps} />);
    const textarea = screen.getByLabelText('Reply');
    fireChange(textarea, 'No send');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockFetchFn).not.toHaveBeenCalled();
  });

  it('shows placeholder text in textarea', () => {
    render(<CommentComposer {...defaultProps} />);
    const textarea = screen.getByLabelText('Reply');
    expect(textarea.getAttribute('placeholder')).toBe('Write a reply...');
  });

  it('calls onClose when Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<CommentComposer {...defaultProps} onClose={onClose} />);
    screen.getByText('Cancel').click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Cancel button is disabled when sending', async () => {
    mockFetchFn.mockReturnValueOnce(new Promise(() => {}));
    render(<CommentComposer {...defaultProps} />);
    typeMessage('Hello');
    fireEvent.click(screen.getByText('Send'));
    await vi.waitFor(() => {
      expect((screen.getByText('Cancel') as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

function fireChange(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

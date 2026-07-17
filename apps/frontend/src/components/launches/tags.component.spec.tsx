import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
let modalConfig: any = null;
const openModal = vi.fn((cfg: any) => {
  modalConfig = cfg;
});

vi.mock('swr', () => ({
  default: vi.fn(),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@mantine/hooks', () => ({
  useClickOutside: () => ({ current: null }),
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal }),
}));

vi.mock('react-tag-autocomplete', () => ({
  ReactTags: () => null,
}));

vi.mock('@gitroom/frontend/components/ui/icons', () => ({
  TagIcon: () => null,
  DropdownArrowIcon: () => null,
  PlusIcon: () => null,
  CheckmarkIcon: () => null,
}));

vi.mock('@gitroom/react/form/input', () => ({
  Input: ({ value, onChange, label }: any) => (
    <input aria-label={label} value={value} onChange={onChange} />
  ),
}));

vi.mock('@gitroom/react/form/color.picker', () => ({
  ColorPicker: () => null,
}));

vi.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

import useSWR from 'swr';
import { TagsComponent, TagsComponentInner } from './tags.component';

const A = { id: '1', name: 'A', color: '#111111' };
const B = { id: '2', name: 'B', color: '#222222' };
const C = { id: '3', name: 'C', color: '#333333' };

describe('TagsComponentInner — create keeps prior toggles (3.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modalConfig = null;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('toggling two tags then creating a third persists all three', async () => {
    const onChange = vi.fn();
    // mutate() re-reads the tag catalog after the new tag is created.
    const mutate = vi.fn().mockResolvedValue({ tags: [A, B, C] });

    render(
      <TagsComponentInner
        name="tags"
        label="Tags"
        initial={[]}
        allTags={{ tags: [A, B] }}
        mutate={mutate}
        onChange={onChange}
      />
    );

    // Open the dropdown (empty state label doubles as the toggle).
    fireEvent.click(screen.getAllByText('Add New Tag')[0]);

    // Toggle A then B.
    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('B'));

    expect(onChange).toHaveBeenLastCalledWith({
      target: {
        name: 'tags',
        value: [
          { label: 'A', value: 'A' },
          { label: 'B', value: 'B' },
        ],
      },
    });

    // Trigger the create flow (bottom "Add New Tag" button).
    fireEvent.click(screen.getByText('Add New Tag'));

    await waitFor(() => expect(modalConfig).not.toBeNull());

    // Drive the real create modal to resolve with a "C" tag name.
    render(modalConfig.children(() => {}));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'C' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({
        target: {
          name: 'tags',
          value: [
            { label: 'A', value: 'A' },
            { label: 'B', value: 'B' },
            { label: 'C', value: 'C' },
          ],
        },
      });
    });
  });
});

describe('TagsComponent — SWR key standardized to /posts/tags (4.6k)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches the tag catalog under the endpoint path', () => {
    vi.mocked(useSWR).mockReturnValue({
      data: { tags: [] },
      isLoading: false,
      mutate: vi.fn(),
    } as any);

    render(
      <TagsComponent
        name="tags"
        label="Tags"
        initial={[]}
        onChange={vi.fn()}
      />
    );

    expect(vi.mocked(useSWR).mock.calls[0][0]).toBe('/posts/tags');
  });
});

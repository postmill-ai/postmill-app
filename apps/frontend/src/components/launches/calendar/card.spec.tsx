import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import dayjs from 'dayjs';

vi.mock('react-dnd', () => ({
  useDrag: () => [{ opacity: 1 }, vi.fn()],
  useDrop: () => [{ canDrop: false }, vi.fn()],
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ disableXAnalytics: false }),
}));

vi.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => ({
    id: 'user-1',
    impersonate: false,
    isSuperAdmin: false,
  }),
}));

vi.mock('@gitroom/helpers/utils/strip.html.validation', () => ({
  stripHtmlValidation: (...args: any[]) => args[1] || '',
}));

vi.mock('@gitroom/frontend/components/launches/creation.method.badge', () => ({
  CreationMethodBadge: () => <div data-testid="creation-method-badge" />,
}));

vi.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: (...args: any[]) => dayjs(...args),
}));

// Heavy transitive deps of ./helpers — mocked so the card renders in isolation.
vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: vi.fn(() => ({ openModal: vi.fn(), closeAll: vi.fn() })),
}));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: vi.fn(() => vi.fn()),
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: vi.fn(() => ({ show: vi.fn() })),
}));
vi.mock('@gitroom/frontend/components/launches/helpers/use.existing.data', () => ({
  ExistingDataContextProvider: ({ children }: any) => children,
}));
vi.mock('@gitroom/frontend/components/composer/composer', () => ({
  Composer: () => <div data-testid="add-edit-modal" />,
}));
vi.mock('@gitroom/frontend/components/analytics-v2/post-analytics.drawer', () => ({
  PostAnalyticsDrawer: () => <div data-testid="post-analytics-drawer" />,
  PostDetailBody: () => <div data-testid="post-detail-body" />,
}));
vi.mock('@gitroom/frontend/components/launches/missing-release.modal', () => ({
  MissingReleaseModal: () => <div data-testid="missing-release-modal" />,
}));
vi.mock('@gitroom/frontend/components/launches/post-detail/post.detail.modal', () => ({
  PostDetailModal: () => <div data-testid="post-detail-modal" />,
}));
vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: vi.fn(() => Promise.resolve(true)),
}));

import { CalendarItem } from './card';

type CalendarItemProps = React.ComponentProps<typeof CalendarItem>;
type CalendarItemPost = CalendarItemProps['post'];

function basePost(
  overrides?: Partial<CalendarItemPost> & Record<string, any>
): CalendarItemPost {
  return {
    id: 'post-1',
    group: 'group-1',
    content: 'Hello card content',
    publishDate: new Date('2024-01-15T12:00:00.000Z'),
    state: 'PUBLISHED',
    integration: {
      id: 'int-1',
      providerIdentifier: 'x',
      picture: '/x.jpg',
      name: 'X',
    },
    tags: [],
    releaseId: 'rel-1',
    releaseURL: 'https://x.com/status/123',
    error: null,
    creationMethod: 'UNKNOWN',
    lastViews: null,
    lastLikes: null,
    lastComments: null,
    commentCount: 0,
    unreadComments: 0,
    intervalInDays: null,
    ...overrides,
  } as CalendarItemPost;
}

function baseProps(overrides?: Partial<CalendarItemProps>): CalendarItemProps {
  return {
    date: dayjs('2024-01-15'),
    isBeforeNow: false,
    editPost: vi.fn(),
    duplicatePost: vi.fn(),
    copyDebugJson: undefined,
    deletePost: vi.fn(),
    statistics: vi.fn(),
    missingRelease: undefined,
    openPostDetail: vi.fn(),
    integrations: [],
    state: 'PUBLISHED',
    display: 'day',
    showTime: false,
    post: basePost(),
    ...overrides,
  };
}

describe('CalendarItem card layout (C2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('post with content and stats', () => {
    const statsPost = () =>
      basePost({ lastViews: 1500, lastLikes: 250, lastComments: 42 });

    it('renders the title row, content text, and stats footer as separate elements', () => {
      render(<CalendarItem {...baseProps()} post={statsPost()} />);

      // Title row (state pill)
      const pill = screen.getByText('Published');
      expect(pill).toBeTruthy();

      // Content text
      const content = screen.getByText('Hello card content');
      expect(content).toBeTruthy();

      // Stats footer
      const views = screen.getByText('1.5K');
      const likes = screen.getByText('250');
      const comments = screen.getByText('42');
      expect(views).toBeTruthy();
      expect(likes).toBeTruthy();
      expect(comments).toBeTruthy();

      // All three are distinct DOM elements — none contains another.
      const titleRow = pill.parentElement!;
      const statsFooter = views.closest('span')!.parentElement!;
      expect(titleRow.contains(content)).toBe(false);
      expect(statsFooter.contains(content)).toBe(false);
      expect(content.contains(views)).toBe(false);
      expect(titleRow).not.toBe(statsFooter);
    });

    it('content element is in normal flow — no absolute positioning class', () => {
      render(<CalendarItem {...baseProps()} post={statsPost()} />);

      const content = screen.getByText('Hello card content');
      expect(content.className.split(/\s+/)).not.toContain('absolute');
    });

    it('stats footer renders when metrics exist', () => {
      const { container } = render(
        <CalendarItem {...baseProps()} post={statsPost()} />
      );

      expect(container.querySelector('span[title="Views"]')).toBeTruthy();
      expect(container.querySelector('span[title="Likes"]')).toBeTruthy();
      expect(container.querySelector('span[title="Replies"]')).toBeTruthy();
    });
  });

  describe('post without stats', () => {
    it('does not render the stats footer (card stays compact)', () => {
      const { container } = render(
        <CalendarItem
          {...baseProps()}
          post={basePost({
            lastViews: null,
            lastLikes: null,
            lastComments: null,
            commentCount: 0,
          })}
        />
      );

      expect(container.querySelector('span[title="Views"]')).toBeNull();
      expect(container.querySelector('span[title="Likes"]')).toBeNull();
      expect(container.querySelector('span[title="Replies"]')).toBeNull();

      // Content still renders in normal flow
      const content = screen.getByText('Hello card content');
      expect(content).toBeTruthy();
      expect(content.className.split(/\s+/)).not.toContain('absolute');
    });
  });
});

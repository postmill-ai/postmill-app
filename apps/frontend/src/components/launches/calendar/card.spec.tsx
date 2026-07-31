import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import dayjs from 'dayjs';

vi.mock('react-dnd', () => ({
  useDrag: () => [{ opacity: 1 }, vi.fn()],
  useDrop: () => [{ canDrop: false }, vi.fn()],
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (key: string, fallback?: string) => fallback || key,
}));

vi.mock('@postmill-ai/react/helpers/variable.context', () => ({
  useVariables: () => ({ disableXAnalytics: false }),
}));

vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({
    id: 'user-1',
    impersonate: false,
    isSuperAdmin: false,
  }),
}));

vi.mock('@postmill-ai/helpers/utils/strip.html.validation', () => ({
  stripHtmlValidation: (...args: any[]) => args[1] || '',
}));

vi.mock('@postmill-ai/frontend/components/launches/creation.method.badge', () => ({
  CreationMethodBadge: () => <div data-testid="creation-method-badge" />,
}));

vi.mock('@postmill-ai/frontend/components/layout/set.timezone', () => ({
  newDayjs: (...args: any[]) => dayjs(...args),
}));

// Heavy transitive deps of ./helpers — mocked so the card renders in isolation.
vi.mock('@postmill-ai/frontend/components/layout/new-modal', () => ({
  useModals: vi.fn(() => ({ openModal: vi.fn(), closeAll: vi.fn() })),
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: vi.fn(() => vi.fn()),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: vi.fn(() => ({ show: vi.fn() })),
}));
vi.mock('@postmill-ai/frontend/components/launches/helpers/use.existing.data', () => ({
  ExistingDataContextProvider: ({ children }: any) => children,
}));
vi.mock('@postmill-ai/frontend/components/composer/composer', () => ({
  Composer: () => <div data-testid="add-edit-modal" />,
}));
vi.mock('@postmill-ai/frontend/components/analytics-v2/post-analytics.drawer', () => ({
  PostAnalyticsDrawer: () => <div data-testid="post-analytics-drawer" />,
  PostDetailBody: () => <div data-testid="post-detail-body" />,
}));
vi.mock('@postmill-ai/frontend/components/launches/missing-release.modal', () => ({
  MissingReleaseModal: () => <div data-testid="missing-release-modal" />,
}));
vi.mock('@postmill-ai/frontend/components/launches/post-detail/post.detail.modal', () => ({
  PostDetailModal: () => <div data-testid="post-detail-modal" />,
}));
vi.mock('@postmill-ai/react/helpers/delete.dialog', () => ({
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

    it('renders identity row, content text, and stats footer as separate elements', () => {
      const { container } = render(
        <CalendarItem {...baseProps()} post={statsPost()} />
      );

      // Status dot: green = published, state carried in the tooltip
      const dot = container.querySelector('[data-tooltip-content="Published"]');
      expect(dot).toBeTruthy();
      expect(dot!.className).toContain('bg-green-500');

      // Identity row: channel name; no profile → no handle segment, and never
      // a literal '@username' placeholder.
      expect(screen.getByText('X')).toBeTruthy();
      expect(screen.queryByText('@username')).toBeNull();

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

      // Content and stats are distinct DOM elements — neither contains the other.
      const statsFooter = views.closest('span')!.parentElement!;
      expect(statsFooter.contains(content)).toBe(false);
      expect(content.contains(views)).toBe(false);
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

  describe('mini post identity', () => {
    it('renders the channel handle from integration.profile', () => {
      render(
        <CalendarItem
          {...baseProps()}
          post={basePost({
            integration: {
              id: 'int-1',
              providerIdentifier: 'x',
              picture: '/x.jpg',
              name: 'X',
              profile: 'maya.solstice',
            },
          })}
        />
      );

      expect(screen.getByText('@maya.solstice')).toBeTruthy();
    });

    it('keeps an already-prefixed handle as-is', () => {
      render(
        <CalendarItem
          {...baseProps()}
          post={basePost({
            integration: {
              id: 'int-1',
              providerIdentifier: 'x',
              picture: '/x.jpg',
              name: 'X',
              profile: '@maya',
            },
          })}
        />
      );

      expect(screen.getByText('@maya')).toBeTruthy();
    });

    it('shows page-style profiles (display names with spaces) without a prefix', () => {
      render(
        <CalendarItem
          {...baseProps()}
          post={basePost({
            integration: {
              id: 'int-1',
              providerIdentifier: 'facebook',
              picture: '/fb.jpg',
              name: 'Solstice Community',
              profile: 'Solstice Base Camp',
            },
          })}
        />
      );

      expect(screen.getByText('Solstice Base Camp')).toBeTruthy();
      expect(screen.queryByText('@Solstice Base Camp')).toBeNull();
    });

    it('hides the handle row segment when the integration has no profile', () => {
      const { container } = render(
        <CalendarItem {...baseProps()} post={basePost()} />
      );

      // basePost's integration carries no profile — only the channel name
      // renders; no handle segment (and no placeholder) appears.
      expect(screen.getByText('X')).toBeTruthy();
      expect(screen.queryByText(/^@/)).toBeNull();
      expect(
        container.querySelector('.text-textColor\\/60')
      ).toBeNull();
    });
  });

  describe('media thumb', () => {
    it('renders the media strip with a +N badge for extra items', () => {
      const { container } = render(
        <CalendarItem
          {...baseProps()}
          post={basePost({ thumb: { path: '/m.jpg', count: 3 } })}
        />
      );

      expect(container.querySelector('img[alt="Media preview"]')).toBeTruthy();
      expect(screen.getByText('+2')).toBeTruthy();
    });

    it('renders no media strip without a thumb', () => {
      const { container } = render(
        <CalendarItem {...baseProps()} post={basePost({ thumb: null })} />
      );

      expect(container.querySelector('img[alt="Media preview"]')).toBeNull();
    });
  });

  describe('failed post', () => {
    it('carries the error message in the failed status dot tooltip', () => {
      const { container } = render(
        <CalendarItem
          {...baseProps({ state: 'ERROR' })}
          post={basePost({ state: 'ERROR', error: 'boom' })}
        />
      );

      const dot = container.querySelector('[data-tooltip-content="boom"]');
      expect(dot).toBeTruthy();
      expect(dot!.className).toContain('bg-red-500');
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

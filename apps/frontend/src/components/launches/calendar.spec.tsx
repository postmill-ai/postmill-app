import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';

vi.mock('react-dnd', () => ({
  useDrag: () => [{ opacity: 1 }, vi.fn()],
  useDrop: () => [{ canDrop: false }, vi.fn()],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
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
  stripHtmlValidation: (...args: any[]) => (args[1] || ''),
}));

vi.mock('@gitroom/react/helpers/safe.image', () => ({
  default: ({ src, className, alt }: any) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    <img src={src} className={className} alt={alt} data-testid="safe-image" />
  ),
}));

vi.mock('@gitroom/frontend/components/launches/creation.method.badge', () => ({
  CreationMethodBadge: () => <div data-testid="creation-method-badge" />,
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: vi.fn(() => ({
    openModal: vi.fn(),
    closeAll: vi.fn(),
  })),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: vi.fn(() => vi.fn()),
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: vi.fn(() => ({
    show: vi.fn(),
  })),
}));

vi.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  useAddProvider: vi.fn(),
}));

vi.mock('@gitroom/frontend/components/launches/calendar.context', () => ({
  CalendarContext: { Provider: ({ children }: any) => children },
  useCalendar: vi.fn(() => ({
    integrations: [],
    posts: [],
    changeDate: vi.fn(),
    display: 'day',
    reloadCalendarView: vi.fn(),
    sets: [],
    signature: undefined,
    loading: false,
    startDate: dayjs().format('YYYY-MM-DD'),
    comments: [],
    listState: 'all',
    setListState: vi.fn(),
    listRangeMode: 'week',
    setListRangeMode: vi.fn(),
    engagementFilter: 'all',
    setEngagementFilter: vi.fn(),
    channelFilter: [],
    setChannelFilter: vi.fn(),
    campaigns: [],
    campaignFilter: [],
    setCampaignFilter: vi.fn(),
    tags: [],
    tagFilter: [],
    setTagFilter: vi.fn(),
    metricFilter: {
      views: { op: 'gte', value: null },
      likes: { op: 'gte', value: null },
      comments: { op: 'gte', value: null },
    },
    setMetricFilter: vi.fn(),
    contentSearch: '',
    setContentSearch: vi.fn(),
    platformFilter: [],
    setPlatformFilter: vi.fn(),
    creationMethodFilter: [],
    setCreationMethodFilter: vi.fn(),
    approvalFilter: [],
    setApprovalFilter: vi.fn(),
    mediaTypeFilter: 'all',
    setMediaTypeFilter: vi.fn(),
    recurringOnly: false,
    setRecurringOnly: vi.fn(),
    unreadOnly: false,
    setUnreadOnly: vi.fn(),
    appliedFilterCount: 0,
    customRange: false,
    applyCustomRange: vi.fn(),
  })),
}));

vi.mock('@gitroom/frontend/components/launches/helpers/use.existing.data', () => ({
  ExistingDataContextProvider: ({ children }: any) => children,
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

vi.mock('@gitroom/frontend/components/composer/composer', () => ({
  Composer: () => <div data-testid="add-edit-modal" />,
}));

vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: (...args: any[]) => dayjs(...args),
}));

vi.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, onClick, type, className }: any) => (
    <button type={type} onClick={onClick} className={className}>{children}</button>
  ),
}));

import { CalendarItem, IconButton } from './calendar';

type CalendarItemProps = React.ComponentProps<typeof CalendarItem>;
type CalendarItemPost = CalendarItemProps['post'];

function basePost(overrides?: Partial<CalendarItemPost> & Record<string, any>): CalendarItemPost {
  return {
    id: 'post-1',
    group: 'group-1',
    content: 'Hello world',
    publishDate: new Date('2024-01-15T12:00:00.000Z'),
    state: 'PUBLISHED',
    integration: {
      id: 'int-1',
      providerIdentifier: 'twitter',
      picture: '/tw.jpg',
      name: 'Twitter',
    },
    tags: [],
    releaseId: 'rel-1',
    releaseURL: 'https://twitter.com/status/123',
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
    changeColor: vi.fn(),
    integrations: [],
    state: 'PUBLISHED',
    display: 'day',
    showTime: false,
    post: basePost(),
    ...overrides,
  };
}

describe('CalendarItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a visible actions kebab menu in the header', () => {
    render(<CalendarItem {...baseProps()} />);
    expect(screen.getByLabelText('Post actions')).toBeTruthy();
  });

  describe('stats footer', () => {
    it('renders when lastViews is present', () => {
      const post = basePost({ lastViews: 1500 });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.getByText('1.5K')).toBeTruthy();
    });

    it('renders when lastLikes is present', () => {
      const post = basePost({ lastLikes: 250 });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.getByText('250')).toBeTruthy();
    });

    it('renders when lastComments is present', () => {
      const post = basePost({ lastComments: 42 });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.getByText('42')).toBeTruthy();
    });

    it('renders all metrics when all are present', () => {
      const post = basePost({ lastViews: 100, lastLikes: 20, lastComments: 5 });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.getByText('100')).toBeTruthy();
      expect(screen.getByText('20')).toBeTruthy();
      expect(screen.getByText('5')).toBeTruthy();
    });

    it('renders when lastViews is 0 (zero)', () => {
      const post = basePost({ lastViews: 0, lastLikes: null, lastComments: null });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.getByText('0')).toBeTruthy();
    });

    it('is hidden when all stats are null', () => {
      render(<CalendarItem {...baseProps()} />);
      expect(screen.queryByText('1.5K')).toBeNull();
      expect(screen.queryByText('250')).toBeNull();
      expect(screen.queryByText('42')).toBeNull();
    });

    it('each stat span has accessible title and aria-label (U10)', () => {
      const post = basePost({ lastViews: 100, lastLikes: 20, lastComments: 5 });
      const { container } = render(<CalendarItem {...baseProps()} post={post} />);

      const viewSpan = container.querySelector('span[title="Views"]');
      expect(viewSpan).toBeDefined();
      expect(viewSpan?.getAttribute('aria-label')).toBe('Views');

      const likesSpan = container.querySelector('span[title="Likes"]');
      expect(likesSpan).toBeDefined();
      expect(likesSpan?.getAttribute('aria-label')).toBe('Likes');

      const commentsSpan = container.querySelector('span[title="Replies"]');
      expect(commentsSpan).toBeDefined();
      expect(commentsSpan?.getAttribute('aria-label')).toBe('Replies');
    });

    it('commentCount stat span also has accessible label', () => {
      const post = basePost({ lastViews: null, lastLikes: null, lastComments: null, commentCount: 8 });
      const { container } = render(<CalendarItem {...baseProps()} post={post} />);

      const commentsSpan = container.querySelector('span[title="Replies"]');
      expect(commentsSpan).toBeDefined();
      expect(commentsSpan?.getAttribute('aria-label')).toBe('Replies');
    });

    it('is hidden when all stats are undefined', () => {
      const post = basePost({
        lastViews: undefined,
        lastLikes: undefined,
        lastComments: undefined,
      });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.queryByText('100')).toBeNull();
      expect(screen.queryByText('50')).toBeNull();
      expect(screen.queryByText('10')).toBeNull();
    });
  });

  describe('state pills', () => {
    it('renders green Published pill for PUBLISHED state', () => {
      render(<CalendarItem {...baseProps()} />);
      const pill = screen.getByText('Published');
      expect(pill).toBeTruthy();
      expect(pill.className).toContain('green');
    });

    it('renders blue Scheduled pill for QUEUE state', () => {
      const post = basePost({ state: 'QUEUE' });
      render(<CalendarItem {...baseProps()} state="QUEUE" post={post} />);
      const pill = screen.getByText('Scheduled');
      expect(pill).toBeTruthy();
      expect(pill.className).toContain('blue');
    });

    it('renders amber Draft pill for DRAFT state', () => {
      const post = basePost({ state: 'DRAFT' });
      render(<CalendarItem {...baseProps()} state="DRAFT" post={post} />);
      const pill = screen.getByText('Draft');
      expect(pill).toBeTruthy();
      expect(pill.className).toContain('amber');
    });

    it('returns no state pill for ERROR state', () => {
      const post = basePost({ state: 'ERROR' });
      render(<CalendarItem {...baseProps()} state="ERROR" post={post} />);
      expect(screen.queryByText('Published')).toBeNull();
      expect(screen.queryByText('Scheduled')).toBeNull();
      expect(screen.queryByText('Draft')).toBeNull();
    });
  });

  describe('unread badge', () => {
    it('renders when unreadComments > 0', () => {
      const post = basePost({ unreadComments: 5 });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.getByText('5')).toBeTruthy();
    });

    it('does not render when unreadComments is 0', () => {
      render(<CalendarItem {...baseProps()} />);
      expect(screen.queryByText('0')).toBeNull();
    });

    it('caps the displayed number at 99+', () => {
      const post = basePost({ unreadComments: 150 });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.getByText('99+')).toBeTruthy();
      expect(screen.queryByText('150')).toBeNull();
    });

    it('caps exactly at 100 → 99+', () => {
      const post = basePost({ unreadComments: 100 });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.getByText('99+')).toBeTruthy();
    });

    it('shows plain number when below 100', () => {
      const post = basePost({ unreadComments: 99 });
      render(<CalendarItem {...baseProps()} post={post} />);
      expect(screen.getByText('99')).toBeTruthy();
      expect(screen.queryByText('99+')).toBeNull();
    });

    it('has red background class', () => {
      const post = basePost({ unreadComments: 3 });
      render(<CalendarItem {...baseProps()} post={post} />);
      const badge = screen.getByText('3');
      expect(badge.className).toContain('red');
    });
  });
});

describe('IconButton', () => {
  it('renders with correct aria-label', () => {
    render(
      <IconButton label="Edit Post" onClick={vi.fn()}>
        <svg data-testid="edit-icon" />
      </IconButton>
    );
    expect(screen.getByLabelText('Edit Post')).toBeTruthy();
  });

  it('renders children inside the button', () => {
    render(
      <IconButton label="Test" onClick={vi.fn()}>
        <svg data-testid="test-icon" />
      </IconButton>
    );
    expect(screen.getByTestId('test-icon')).toBeTruthy();
  });

  it('has role="button"', () => {
    render(
      <IconButton label="Test" onClick={vi.fn()}>
        <svg />
      </IconButton>
    );
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Edit Post" onClick={onClick}>
        <svg />
      </IconButton>
    );
    fireEvent.click(screen.getByLabelText('Edit Post'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Enter keydown', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Edit Post" onClick={onClick}>
        <svg />
      </IconButton>
    );
    fireEvent.keyDown(screen.getByLabelText('Edit Post'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Space keydown', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Edit Post" onClick={onClick}>
        <svg />
      </IconButton>
    );
    fireEvent.keyDown(screen.getByLabelText('Edit Post'), { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('prevents default on Space keydown', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Edit Post" onClick={onClick}>
        <svg />
      </IconButton>
    );
    const button = screen.getByLabelText('Edit Post');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    button.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('does not call onClick on other keydown (Tab)', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Edit Post" onClick={onClick}>
        <svg />
      </IconButton>
    );
    fireEvent.keyDown(screen.getByLabelText('Edit Post'), { key: 'Tab' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has tabIndex={0}', () => {
    render(
      <IconButton label="Test" onClick={vi.fn()}>
        <svg />
      </IconButton>
    );
    expect(screen.getByRole('button').getAttribute('tabindex')).toBe('0');
  });
});

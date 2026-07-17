import React from 'react';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  cleanup,
} from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// ---------------------------------------------------------------------------
// Shared mutable holder — vi.mock factories are hoisted, so they read from this
// (populated per-test in beforeEach). Reassigning `h.*` between tests works
// because the mock closures call through to `h` at invocation time.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  fetchImpl: (..._a: any[]) => Promise.resolve({ ok: true, json: async () => ({}) }) as any,
  runPreflightImpl: (..._a: any[]) => Promise.resolve(null) as any,
  state: {} as any,
  existing: {} as any,
  getAllValues: [] as any[],
  toasterShow: vi.fn(),
  closeAll: vi.fn(),
  openModal: vi.fn(),
  routerPush: vi.fn(),
  aiActive: false,
}));

const res = (ok: boolean, status: number, body: any) => ({
  ok,
  status,
  json: async () => body,
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback || _key,
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => (...args: any[]) => h.fetchImpl(...args),
}));

vi.mock('@gitroom/frontend/components/composer/content-qa/usePreflight', () => ({
  usePreflight: () => ({
    runPreflight: (...args: any[]) => h.runPreflightImpl(...args),
    loading: false,
    data: null,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock(
  '@gitroom/frontend/components/composer/content-qa/preflight.panel',
  () => ({
    PreflightPanel: ({ onProceed, onClose }: any) => (
      <div data-testid="preflight-panel">
        <button data-testid="preflight-proceed" onClick={onProceed}>
          Proceed
        </button>
        <button data-testid="preflight-close" onClick={onClose}>
          Close
        </button>
      </div>
    ),
  })
);

vi.mock('@gitroom/frontend/components/composer/store', () => ({
  useLaunchStore: (selector: any) => selector(h.state),
}));

vi.mock('@gitroom/frontend/components/launches/helpers/use.existing.data', () => ({
  useExistingData: () => h.existing,
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: (...a: any[]) => h.toasterShow(...a) }),
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({
    openModal: (...a: any[]) => h.openModal(...a),
    closeAll: (...a: any[]) => h.closeAll(...a),
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...a: any[]) => h.routerPush(...a) }),
}));

vi.mock('@gitroom/frontend/components/layout/use-ai-active', () => ({
  useAiActive: () => h.aiActive,
}));

vi.mock(
  '@gitroom/frontend/components/settings/shortlink-preference.component',
  () => ({
    useShortlinkPreference: () => ({ data: { shortlink: 'NO' } }),
    ShortlinkPreferenceComponent: () => null,
  })
);

vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: vi.fn(async () => true),
}));

vi.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: () => 'grp-generated',
}));

// ShowAllProviders exposes getAllValues through its ref — the composer reads it.
vi.mock(
  '@gitroom/frontend/components/composer/providers/show.all.providers',
  async () => {
    const RealReact = (await vi.importActual<any>('react')).default;
    return {
      ShowAllProviders: RealReact.forwardRef((_props: any, ref: any) => {
        RealReact.useImperativeHandle(ref, () => ({
          getAllValues: async () => h.getAllValues,
        }));
        return <div data-testid="providers" />;
      }),
    };
  }
);

// Lightweight stubs for the remaining heavy children.
vi.mock('@gitroom/frontend/components/composer/picks.socials.component', () => ({
  PicksSocialsComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/composer/editor', () => ({
  EditorWrapper: () => null,
}));
vi.mock('@gitroom/frontend/components/composer/select.current', () => ({
  SelectCurrent: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/helpers/date.picker', () => ({
  DatePicker: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/repeat.component', () => ({
  RepeatComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/tags.component', () => ({
  TagsComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/select.customer', () => ({
  SelectCustomer: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/brand-picker', () => ({
  BrandPicker: () => null,
}));
vi.mock('@gitroom/frontend/components/composer/shortlink-picker', () => ({
  ShortlinkPicker: () => null,
}));
vi.mock('@gitroom/frontend/components/launches/creation.method.badge', () => ({
  CreationMethodBadge: () => null,
}));
vi.mock('@gitroom/frontend/components/composer/dummy.code.component', () => ({
  DummyCodeComponent: () => null,
}));
vi.mock('@gitroom/frontend/components/composer/composer-library.modal', () => ({
  ComposerLibraryModal: () => null,
}));
vi.mock('@gitroom/frontend/components/ui/color-picker', () => ({
  ColorPicker: () => null,
  DEFAULT_POST_COLOR: '#2B5CD3',
}));
vi.mock('@gitroom/frontend/components/ui/icons', () => ({
  SettingsIcon: () => null,
  ChevronDownIcon: () => null,
  TrashIcon: () => null,
  DropdownArrowSmallIcon: () => null,
}));
vi.mock('@gitroom/frontend/components/ui/is.scroll.hook', () => ({
  useHasScroll: () => false,
}));
vi.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
}));
vi.mock('@gitroom/react/helpers/safe.image', () => ({
  default: () => null,
}));
vi.mock('@copilotkit/react-ui', () => ({
  CopilotChat: () => null,
}));

// Import AFTER mocks are registered.
import { ManageModal } from './manage.modal';

const PASSING_PREFLIGHT = {
  passed: true,
  results: [
    {
      integrationId: 'int1',
      identifier: 'x-provider',
      name: 'X',
      valid: true,
      warnings: [],
      blocks: [],
    },
  ],
  blocking: [],
};

const VALID_OK = [
  {
    id: 'int1',
    identifier: 'x-provider',
    name: 'X',
    valid: true,
    errors: true,
    emptyContent: false,
    tooLong: false,
  },
];

const renderModal = (overrides: Partial<any> = {}) =>
  render(
    <ManageModal
      {...({ mutate: vi.fn(), dummy: false, ...overrides } as any)}
    />
  );

const scheduleButton = () =>
  screen.getByRole('button', { name: /add to calendar/i });

describe('ManageModal', () => {
  beforeEach(() => {
    h.toasterShow = vi.fn();
    h.closeAll = vi.fn();
    h.openModal = vi.fn();
    h.routerPush = vi.fn();
    h.aiActive = false;
    h.existing = { group: undefined, integration: undefined, posts: [] };
    h.getAllValues = [
      {
        id: 'int1',
        settings: {},
        values: [{ id: 'v1', content: 'hi', delay: 0, media: [] }],
      },
    ];
    h.runPreflightImpl = vi.fn(async () => PASSING_PREFLIGHT);
    h.fetchImpl = vi.fn(async (url: string) => {
      if (url === '/posts/valid') return res(true, 200, VALID_OK);
      if (url === '/posts') return res(true, 200, {});
      return res(true, 200, {});
    });
    h.state = {
      hide: false,
      setHide: vi.fn(),
      date: dayjs(),
      setDate: vi.fn(),
      current: 'global',
      repeater: undefined,
      setRepeater: vi.fn(),
      tags: [],
      setTags: vi.fn(),
      selectedIntegrations: [
        { integration: { id: 'int1' }, settings: {}, ref: { current: {} } },
      ],
      integrations: [
        { id: 'int1', identifier: 'x-provider', name: 'X', customer: null },
      ],
      setSelectedIntegrations: vi.fn(),
      locked: false,
      activateExitButton: false,
      brandId: undefined,
      campaignId: undefined,
      global: [{ id: 'g1', content: '<p>hi</p>', delay: 0, media: [] }],
      internal: [],
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const postCalls = () =>
    (h.fetchImpl as any).mock.calls.filter((c: any[]) => c[0] === '/posts')
      .length;

  // 0.11 — save discards the POST Response.
  it('0.11: keeps the modal open and toasts the server message when the save fails', async () => {
    h.fetchImpl = vi.fn(async (url: string) => {
      if (url === '/posts/valid') return res(true, 200, VALID_OK);
      if (url === '/posts') return res(false, 400, { message: 'boom' });
      return res(true, 200, {});
    });

    renderModal();
    await act(async () => {
      fireEvent.click(scheduleButton());
    });
    await waitFor(() => expect(postCalls()).toBe(1));

    const shown = h.toasterShow.mock.calls.flat();
    expect(shown).toContain('boom');
    expect(shown).not.toContain('Added successfully');
    // Modal stays open (never closed) and the button is re-enabled.
    expect(h.closeAll).not.toHaveBeenCalled();
    await waitFor(() => expect((scheduleButton() as HTMLButtonElement).disabled).toBe(false));
  });

  // 3.8 — double-submit window before setLoading(true).
  it('3.8: a second click during preflight does not create a second post', async () => {
    let resolvePreflight!: (v: any) => void;
    h.runPreflightImpl = vi.fn(
      () =>
        new Promise((r) => {
          resolvePreflight = r;
        })
    );

    renderModal();
    const btn = scheduleButton();

    // First click: preflight is in flight; loading lock disables the button.
    await act(async () => {
      fireEvent.click(btn);
    });
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    // Second click during the preflight window is ignored (button disabled).
    await act(async () => {
      fireEvent.click(btn);
    });

    await act(async () => {
      resolvePreflight(PASSING_PREFLIGHT);
      await Promise.resolve();
    });

    await waitFor(() => expect(postCalls()).toBe(1));
  });

  // 3.9 — unsaved-changes guard must inspect `internal` (edit mode).
  it('3.9: arms the beforeunload guard when editing content lives in internal', async () => {
    h.state.activateExitButton = true;
    h.state.global = [{ id: 'g1', content: '', delay: 0, media: [] }];
    h.state.internal = [
      {
        integration: { id: 'int1' },
        integrationValue: [
          { id: 'v1', content: '<p>edited</p>', delay: 0, media: [] },
        ],
      },
    ];

    const addSpy = vi.spyOn(window, 'addEventListener');
    renderModal();

    expect(
      addSpy.mock.calls.some((c) => c[0] === 'beforeunload')
    ).toBe(true);
    addSpy.mockRestore();
  });

  // 3.10 — /posts/valid response not ok-checked.
  it('3.10: toasts and re-enables the button when /posts/valid errors', async () => {
    h.fetchImpl = vi.fn(async (url: string) => {
      if (url === '/posts/valid') return res(false, 500, { message: 'nope' });
      if (url === '/posts') return res(true, 200, {});
      return res(true, 200, {});
    });

    renderModal();
    await act(async () => {
      fireEvent.click(scheduleButton());
    });

    await waitFor(() =>
      expect(h.toasterShow.mock.calls.flat()).toContain('nope')
    );
    // Never POSTed the post, and the button is usable again.
    expect(postCalls()).toBe(0);
    await waitFor(() => expect((scheduleButton() as HTMLButtonElement).disabled).toBe(false));
  });

  // 3.13 — warnings-only opens the panel; Proceed submits exactly once.
  it('3.13: warnings-only opens the preflight panel and Proceed submits once', async () => {
    h.runPreflightImpl = vi.fn(async () => ({
      passed: false,
      results: [
        {
          integrationId: 'int1',
          identifier: 'x-provider',
          name: 'X',
          valid: true,
          warnings: ['Consider a shorter caption'],
          blocks: [],
        },
      ],
      blocking: [],
    }));

    renderModal();
    await act(async () => {
      fireEvent.click(scheduleButton());
    });

    // Panel opened even though there are zero blocking issues.
    const panel = await screen.findByTestId('preflight-panel');
    expect(panel).toBeTruthy();
    expect(postCalls()).toBe(0);

    // Proceed bypasses the re-check and submits.
    await act(async () => {
      fireEvent.click(screen.getByTestId('preflight-proceed'));
    });

    await waitFor(() => expect(postCalls()).toBe(1));
    // Preflight ran once (the initial run), not again on Proceed.
    expect(h.runPreflightImpl).toHaveBeenCalledTimes(1);
  });
});

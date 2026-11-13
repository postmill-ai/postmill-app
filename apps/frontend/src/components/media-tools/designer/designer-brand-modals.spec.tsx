import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Designer } from './designer';
import { ModalManager, useModals } from '@postmill-ai/frontend/components/layout/new-modal';

const mocks = vi.hoisted(() => ({
  actionCtx: null as import('./actions').DesignerActionCtx | null,
  closeAll: null as (() => void) | null,
  fetch: vi.fn(),
  brands: {
    data: [
      {
        id: 'brand-a',
        name: 'A',
        enabled: true,
        isDefault: true,
        palette: ['#aaaaaa'],
        fontFamilies: ['A Font'],
        enforcement: { enabled: false },
      },
    ],
    mutate: vi.fn(),
  },
}));

vi.mock('./actions', () => ({
  useDesignerActions: (_store: unknown, ctx: import('./actions').DesignerActionCtx) => {
    mocks.actionCtx = ctx;
    return [];
  },
}));
vi.mock('@postmill-ai/frontend/components/settings/brand/use-brands', () => ({
  useBrands: () => mocks.brands,
}));
vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetch,
}));
vi.mock('@postmill-ai/frontend/components/layout/user.context', () => ({
  useUser: () => ({ orgId: 'org-1', role: 'admin' }),
}));
vi.mock('@postmill-ai/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@postmill-ai/frontend/components/layout/use-ai-active', () => ({
  useAiActive: () => false,
}));
vi.mock('@postmill-ai/frontend/components/layout/use-media-tools-status', () => ({
  useMediaToolsStatus: () => ({ status: undefined }),
}));
vi.mock('./collaboration', () => ({
  useCollaboration: () => ({
    sendUpdate: vi.fn(),
    sendImageAwareness: vi.fn(),
    sendTimelineAwareness: vi.fn(),
  }),
}));
vi.mock('./use-pixel-ops', () => ({
  usePixelOps: () => ({
    baking: false,
    canEditPixels: false,
    hasLastFilter: false,
    hasSmartFilters: false,
  }),
}));
vi.mock('../use-media-picker', () => ({
  useMediaPicker: () => ({ open: vi.fn(), openWith: vi.fn(), element: null }),
}));
vi.mock('./canvas', () => ({ DesignerCanvas: () => null }));
vi.mock('./video-timeline', () => ({ VideoTimeline: () => null }));
vi.mock('./selection-toolbar', () => ({ SelectionToolbar: () => null }));
vi.mock('./collaboration-cursors', () => ({ CollaborationCursors: () => null }));
vi.mock('./menu-bar', () => ({ MenuBar: () => null }));
vi.mock('./command-palette', () => ({ CommandPalette: () => null }));
vi.mock('./tool-rail', () => ({ ToolRail: () => null }));
vi.mock('./tool-options-bar', () => ({
  ToolOptionsBar: () => null,
  defaultToolOptions: () => ({}),
}));
vi.mock('./output-tabs', () => ({ OutputTabs: () => null }));
vi.mock('./panels/pages-panel', () => ({ PagesPanel: () => null }));
vi.mock('./panels/inspector-panel', () => ({ InspectorPanel: () => null }));
vi.mock('./panels/canvas-inspector', () => ({ CanvasInspector: () => null }));
vi.mock('./mobile-designer-tools', () => ({
  MobileQuickActions: () => null,
  MobileSheetHeader: () => null,
  MobileToolsDialog: () => null,
  MobileWorkspaceSheet: () => null,
}));
vi.mock('@postmill-ai/frontend/components/media-tools/fullscreen-button', () => ({
  FullscreenButton: () => null,
}));
vi.mock('@postmill-ai/frontend/components/ui/kebab-menu', () => ({
  KebabMenu: () => null,
}));

const ModalControls = () => {
  const { closeAll } = useModals();
  React.useEffect(() => {
    mocks.closeAll = closeAll;
    return () => {
      mocks.closeAll = null;
    };
  }, [closeAll]);
  return null;
};

const renderDesigner = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ModalManager>
        <ModalControls />
        <Designer width={1080} height={1080} />
      </ModalManager>
    </SWRConfig>
  );

describe('Designer brand context in app-root modals', () => {
  beforeEach(() => {
    mocks.fetch.mockImplementation(async (url: string) => {
      const body = url.startsWith('/media/design-templates?')
        ? { templates: [], total: 0, page: 1, limit: 24 }
        : [];
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
  });

  afterEach(() => {
    act(() => mocks.closeAll?.());
    cleanup();
    vi.clearAllMocks();
    mocks.actionCtx = null;
    mocks.closeAll = null;
  });

  it('renders ExportDialog through the real modal manager with brand context', async () => {
    renderDesigner();

    await act(async () => mocks.actionCtx?.onExport());

    expect(await screen.findByText('Export Design')).toBeTruthy();
  });

  it('renders TemplatesPanel through the real modal manager with the selected brand', async () => {
    renderDesigner();

    await act(async () => mocks.actionCtx?.onBrowseTemplates());

    expect(await screen.findByText('No templates yet')).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/media/design-templates?page=1&limit=24&brandId=brand-a'
    );
  });
});

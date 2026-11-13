'use client';

import React, { FC, useEffect, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import { AiPanel } from './panels/ai-panel';
import { BrandPanel } from './panels/brand-panel';
import { CanvasInspector } from './panels/canvas-inspector';
import { InspectorPanel } from './panels/inspector-panel';
import { LayersFooter } from './panels/layers-footer';
import { LayersPanel } from './panels/layers-panel';

export type WorkspaceTab = 'inspector' | 'layers' | 'brand' | 'ai';

export interface DesktopWorkspacePreference {
  activeTab: WorkspaceTab;
  collapsed: boolean;
}

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const workspaceTabs = new Set<WorkspaceTab>(['inspector', 'layers', 'brand', 'ai']);
const storageSuffix = (orgId?: string | null) => orgId ? `-${orgId}` : '';

export const isMobileDesignerViewport = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 1025px)').matches;

export const readDesktopWorkspacePreference = (
  storage: Pick<Storage, 'getItem'>,
  orgId?: string | null
): DesktopWorkspacePreference => {
  const suffix = storageSuffix(orgId);
  try {
    const saved = JSON.parse(storage.getItem(`designer-workspace-panel${suffix}`) || 'null');
    if (workspaceTabs.has(saved?.activeTab) && typeof saved?.collapsed === 'boolean') {
      return saved;
    }
  } catch {
    // Fall through to the legacy floating-panel preferences.
  }

  const legacyOpen = (panel: 'layers' | 'brand') => {
    try {
      return !!JSON.parse(storage.getItem(`designer-${panel}-panel${suffix}`) || 'null')?.open;
    } catch {
      return false;
    }
  };
  return {
    activeTab: legacyOpen('brand') ? 'brand' : legacyOpen('layers') ? 'layers' : 'inspector',
    collapsed: false,
  };
};

export const writeDesktopWorkspacePreference = (
  storage: PreferenceStorage,
  orgId: string | null | undefined,
  preference: DesktopWorkspacePreference
) => {
  try {
    storage.setItem(
      `designer-workspace-panel${storageSuffix(orgId)}`,
      JSON.stringify(preference)
    );
  } catch {
    // Private mode or a full storage quota only disables persistence.
  }
};

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

interface DesktopWorkspacePanelProps {
  store: Store;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onClose: () => void;
  hasInspectorTarget: boolean;
  currentOutput: number;
  currentOutputSizeKey: string;
  collapsed?: boolean;
}

export const DesktopWorkspacePanel: FC<DesktopWorkspacePanelProps> = ({
  store,
  activeTab,
  onTabChange,
  onClose,
  hasInspectorTarget,
  currentOutput,
  currentOutputSizeKey,
  collapsed = false,
}) => {
  const t = useT();
  const [activated, setActivated] = useState<ReadonlySet<'brand' | 'ai'>>(() => new Set());
  useEffect(() => {
    if (collapsed || (activeTab !== 'brand' && activeTab !== 'ai')) return;
    const activation = setTimeout(() => {
      setActivated((current) => current.has(activeTab)
        ? current
        : new Set(current).add(activeTab));
    }, 0);
    return () => clearTimeout(activation);
  }, [activeTab, collapsed]);
  const title = {
    inspector: hasInspectorTarget
      ? t('inspector_panel_label', 'Inspector')
      : t('canvas_panel_label', 'Canvas'),
    layers: t('panel_layers', 'Layers'),
    brand: t('brand_label', 'Brand'),
    ai: t('ai', 'AI'),
  }[activeTab];

  return (
    <div
      role="region"
      aria-label={title}
      data-workspace-panel={activeTab}
      hidden={collapsed}
      className={`absolute end-0 top-0 bottom-0 w-[320px] z-20 flex-col border-s border-studioBorder bg-newBgColorInner shadow-xl ${collapsed ? 'hidden' : 'flex'}`}
    >
      <div className="flex items-center border-b border-studioBorder shrink-0">
        <OverflowTabs
          items={[
            { key: 'inspector', label: t('inspector_panel_label', 'Inspector') },
            { key: 'layers', label: t('panel_layers', 'Layers') },
            { key: 'brand', label: t('brand_label', 'Brand') },
            { key: 'ai', label: t('ai', 'AI') },
          ]}
          activeKey={activeTab}
          onSelect={(key) => onTabChange(key as WorkspaceTab)}
          variant="underline"
          semantics="tabs"
          ariaLabel={t('designer_workspace_tabs', 'Workspace panels')}
          listAriaLabel={t('designer_workspace_tabs', 'Workspace panels')}
          className="min-w-0 flex-1 border-b-0 [&_button]:px-[10px] [&_button]:text-[12px]"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={t('collapse_panel', 'Collapse panel')}
          title={t('collapse_panel', 'Collapse panel')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-textColor/60 hover:bg-studioBorder/30 hover:text-textColor focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-designerAccent"
        >
          <span className="inline-block rtl:rotate-180">›</span>
        </button>
      </div>

      {activeTab === 'layers' && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <LayersPanel store={store} />
          </div>
          <LayersFooter store={store} />
        </>
      )}
      <div hidden={activeTab === 'layers'} className="min-h-0 flex-1 overflow-y-auto p-3">
        <div hidden={activeTab !== 'inspector'}>
          {hasInspectorTarget ? (
            <InspectorPanel store={store} />
          ) : (
            <CanvasInspector
              key={`canvas-${currentOutput}-${currentOutputSizeKey}`}
              store={store}
            />
          )}
        </div>
        {activated.has('brand') && (
          <div hidden={activeTab !== 'brand'}>
            <BrandPanel store={store} />
          </div>
        )}
        {activated.has('ai') && (
          <div hidden={activeTab !== 'ai'}>
            <AiPanel store={store} />
          </div>
        )}
      </div>
    </div>
  );
};

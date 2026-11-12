'use client';

import React, { FC } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import { AiPanel } from './panels/ai-panel';
import { BrandPanel } from './panels/brand-panel';
import { CanvasInspector } from './panels/canvas-inspector';
import { InspectorPanel } from './panels/inspector-panel';
import { LayersFooter } from './panels/layers-footer';
import { LayersPanel } from './panels/layers-panel';

export type WorkspaceTab = 'inspector' | 'layers' | 'brand' | 'ai';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

interface DesktopWorkspacePanelProps {
  store: Store;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onClose: () => void;
  hasInspectorTarget: boolean;
  currentOutput: number;
  currentOutputSizeKey: string;
}

export const DesktopWorkspacePanel: FC<DesktopWorkspacePanelProps> = ({
  store,
  activeTab,
  onTabChange,
  onClose,
  hasInspectorTarget,
  currentOutput,
  currentOutputSizeKey,
}) => {
  const t = useT();
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
      className="absolute end-0 top-0 bottom-0 w-[320px] z-20 flex flex-col border-s border-studioBorder bg-newBgColorInner shadow-xl"
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
          <span className="rtl:rotate-180">›</span>
        </button>
      </div>

      {activeTab === 'layers' ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <LayersPanel store={store} />
          </div>
          <LayersFooter store={store} />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {activeTab === 'inspector' && (
            hasInspectorTarget ? (
              <InspectorPanel store={store} />
            ) : (
              <CanvasInspector
                key={`canvas-${currentOutput}-${currentOutputSizeKey}`}
                store={store}
              />
            )
          )}
          {activeTab === 'brand' && <BrandPanel store={store} />}
          {activeTab === 'ai' && <AiPanel store={store} />}
        </div>
      )}
    </div>
  );
};

'use client';

import React, { FC, useState } from 'react';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import { StockAudio } from '@postmill-ai/frontend/components/media-tools/stock-audio';
import { StockIcons } from '@postmill-ai/frontend/components/media-tools/stock-icons';
import { StockPhotos } from '@postmill-ai/frontend/components/media-tools/stock-photos';
import { StockStickers } from '@postmill-ai/frontend/components/media-tools/stock-stickers';
import { StockVectors } from '@postmill-ai/frontend/components/media-tools/stock-vectors';
import { StockVideos } from '@postmill-ai/frontend/components/media-tools/stock-videos';
import type { StockMediaSelection } from '@postmill-ai/frontend/components/media-tools/stock.types';
import { mediaItemFromStockSelection, writeStockMediaDrag } from '../stock-media-drag';
import type { DesignerMediaKind, InsertDesignerMedia } from '../use-designer-media-insertion';

type CategoryId = 'photos' | 'videos' | 'vectors' | 'icons' | 'stickers' | 'audio';

const categories: Array<{ id: CategoryId; kind: DesignerMediaKind; labelKey: string; label: string }> = [
  { id: 'photos', kind: 'image', labelKey: 'photos', label: 'Photos' },
  { id: 'videos', kind: 'video', labelKey: 'videos', label: 'Videos' },
  { id: 'vectors', kind: 'vector', labelKey: 'vectors_tab', label: 'Vectors' },
  { id: 'icons', kind: 'icon', labelKey: 'panel_icons', label: 'Icons' },
  { id: 'stickers', kind: 'sticker', labelKey: 'uploads_panel_stickers', label: 'Stickers' },
  { id: 'audio', kind: 'audio', labelKey: 'audio', label: 'Audio' },
];

interface ElementsPanelProps {
  onInsertMedia: InsertDesignerMedia;
}

export const ElementsPanel: FC<ElementsPanelProps> = ({ onInsertMedia }) => {
  const t = useT();
  const [active, setActive] = useState<CategoryId>('photos');
  const [activated, setActivated] = useState<ReadonlySet<CategoryId>>(() => new Set(['photos']));

  const activate = (id: CategoryId) => {
    setActive(id);
    setActivated((current) => current.has(id) ? current : new Set(current).add(id));
  };

  const browser = (kind: DesignerMediaKind, id: CategoryId) => {
    const onSelectFull = (item: StockMediaSelection) => {
      void onInsertMedia(kind, mediaItemFromStockSelection(item));
    };
    const onDragStart = (item: StockMediaSelection, event: React.DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.effectAllowed = 'copy';
      writeStockMediaDrag(event.dataTransfer, kind, item);
    };
    const props = { mode: 'select' as const, onSelectFull, onDragStart, compact: true };
    switch (id) {
      case 'photos': return <StockPhotos {...props} />;
      case 'videos': return <StockVideos {...props} />;
      case 'vectors': return <StockVectors {...props} />;
      case 'icons': return <StockIcons {...props} />;
      case 'stickers': return <StockStickers {...props} />;
      case 'audio': return <StockAudio mode="select" onSelectFull={onSelectFull} onDragStart={onDragStart} />;
    }
  };

  return (
    <div className="flex flex-col gap-[12px]">
      <OverflowTabs
        items={categories.map((category) => ({
          key: category.id,
          label: t(category.labelKey, category.label),
        }))}
        activeKey={active}
        onSelect={(key) => activate(key as CategoryId)}
        variant="pill"
        semantics="tabs"
        ariaLabel={t('elements_asset_types', 'Asset types')}
        listAriaLabel={t('elements_asset_types', 'Asset types')}
      />
      {categories.filter((category) => activated.has(category.id)).map((category) => (
        <div key={category.id} hidden={active !== category.id} data-elements-category={category.id}>
          {browser(category.kind, category.id)}
        </div>
      ))}
    </div>
  );
};

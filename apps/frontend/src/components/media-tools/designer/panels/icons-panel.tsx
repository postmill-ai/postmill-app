'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import type { DesignerElement } from '../designer.store';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface IconsPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
}

/**
 * A small set of open-licensed (MIT/CC0-style) geometric/UI glyphs defined as
 * inline 24×24 SVG path data — no external fetch. Each icon is rasterised onto
 * the canvas as an image element via a data-URL SVG, which renders cleanly
 * through the existing `ImageNode` renderer.
 */
interface IconDef {
  name: string;
  keywords: string;
  /** Inner SVG markup (paths/shapes) on a 24×24 viewBox. */
  body: string;
}

const ICONS: IconDef[] = [
  { name: 'star', keywords: 'favorite rating', body: '<path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21l1.18-6.88-5-4.87 7.1-1.01z"/>' },
  { name: 'heart', keywords: 'love like', body: '<path d="M12 21s-7.5-4.6-10-9.2C.6 8.9 2.2 5.5 5.5 5.5c2 0 3.4 1.2 4.5 2.6 1.1-1.4 2.5-2.6 4.5-2.6 3.3 0 4.9 3.4 3.5 6.3C19.5 16.4 12 21 12 21z"/>' },
  { name: 'circle', keywords: 'dot round', body: '<circle cx="12" cy="12" r="9"/>' },
  { name: 'square', keywords: 'box rect', body: '<rect x="4" y="4" width="16" height="16" rx="2"/>' },
  { name: 'triangle', keywords: 'arrow up', body: '<path d="M12 3l9 16H3z"/>' },
  { name: 'diamond', keywords: 'gem rhombus', body: '<path d="M12 2l10 10-10 10L2 12z"/>' },
  { name: 'hexagon', keywords: 'badge', body: '<path d="M7 3h10l5 9-5 9H7l-5-9z"/>' },
  { name: 'check', keywords: 'tick done ok', body: '<path d="M4 12l5 5L20 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' },
  { name: 'cross', keywords: 'close x cancel', body: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' },
  { name: 'plus', keywords: 'add new', body: '<path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' },
  { name: 'minus', keywords: 'remove subtract', body: '<path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' },
  { name: 'arrow-up', keywords: 'up north', body: '<path d="M12 4l-7 7h4v9h6v-9h4z"/>' },
  { name: 'arrow-right', keywords: 'next forward', body: '<path d="M20 12l-7-7v4H4v6h9v4z"/>' },
  { name: 'bolt', keywords: 'lightning flash energy', body: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>' },
  { name: 'bell', keywords: 'notification alert', body: '<path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z"/>' },
  { name: 'flag', keywords: 'marker country', body: '<path d="M6 3v18M6 4h11l-2 4 2 4H6"/>' },
  { name: 'tag', keywords: 'label price', body: '<path d="M3 12l9-9 9 9-9 9z"/><circle cx="9" cy="9" r="1.5" fill="#fff"/>' },
  { name: 'pin', keywords: 'location map place', body: '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/>' },
  { name: 'sun', keywords: 'weather day light', body: '<circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  { name: 'moon', keywords: 'night dark', body: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>' },
  { name: 'cloud', keywords: 'weather sky', body: '<path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.3A3.5 3.5 0 0 1 18 18z"/>' },
  { name: 'play', keywords: 'video media', body: '<path d="M7 4v16l13-8z"/>' },
  { name: 'pause', keywords: 'stop media', body: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>' },
  { name: 'home', keywords: 'house main', body: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
  { name: 'user', keywords: 'person profile account', body: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/>' },
  { name: 'chat', keywords: 'message bubble talk', body: '<path d="M4 4h16v12H8l-4 4z"/>' },
  { name: 'gear', keywords: 'settings cog', body: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/><path d="M12 2l1.6 3 3.3-.6.6 3.3 3 1.6-1.7 2.9 1.7 2.9-3 1.6-.6 3.3-3.3-.6L12 22l-1.6-3-3.3.6-.6-3.3-3-1.6 1.7-2.9-1.7-2.9 3-1.6.6-3.3 3.3.6z" fill="none" stroke="currentColor" stroke-width="1.5"/>' },
  { name: 'eye', keywords: 'view visible watch', body: '<path d="M12 5c-5 0-9 5-9 7s4 7 9 7 9-5 9-7-4-7-9-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>' },
];

const SIZE = 120;

export const IconsPanel: FC<IconsPanelProps> = ({ store, onClose }) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const fill = '#2B5CD3';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICONS;
    return ICONS.filter(
      (icon) =>
        icon.name.includes(q) || icon.keywords.includes(q)
    );
  }, [query]);

  const addIcon = useCallback(
    (icon: IconDef) => {
      const state = store.getState();
      const out = state.doc.outputs[state.currentOutput];
      const cx = out.width / 2 - SIZE / 2;
      const cy = out.height / 2 - SIZE / 2;
      const el: DesignerElement = {
        id: '',
        type: 'icon',
        x: cx,
        y: cy,
        width: SIZE,
        height: SIZE,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        name: `icon-${icon.name}`,
        src: icon.body,
        fill,
      };
      state.addElement(el);
      onClose?.();
    },
    [store, onClose, fill]
  );

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('icons_panel_search_icons_placeholder', 'Search icons…')}
        className="w-full h-[36px] px-3 rounded-lg bg-newBgColorInner border border-studioBorder text-[13px] outline-none focus:border-designerAccent text-textColor"
      />

      {filtered.length === 0 ? (
        <div className="text-[12px] text-newTextColor/60 text-center py-4">
          {t('icons_panel_no_icons_found', 'No icons found')}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {filtered.map((icon) => (
            <button
              key={icon.name}
              type="button"
              title={icon.name}
              aria-label={icon.name}
              onClick={() => addIcon(icon)}
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData(
                  'application/x-designer-element',
                  JSON.stringify({
                    type: 'icon',
                    src: icon.body,
                    fill,
                    width: SIZE,
                    height: SIZE,
                  })
                )
              }
              className="aspect-square flex items-center justify-center rounded-lg border border-studioBorder bg-newBgColorInner text-btnPrimaryAccent hover:border-designerAccent hover:bg-studioBorder/10 transition-all"
            >
              <svg
                viewBox="0 0 24 24"
                width={26}
                height={26}
                fill="currentColor"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: icon.body }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

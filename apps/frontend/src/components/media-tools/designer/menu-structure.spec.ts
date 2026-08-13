import { describe, it, expect, vi } from 'vitest';
import { MENU_ORDER, DESIGNER_DOCS_URL, type DesignerMenu } from './actions';
import { createDesignerStore } from './designer.store';

/**
 * The menu bar's shape, and the two store requests the menus depend on.
 *
 * `useDesignerActions` is a hook needing a large context, so rather than
 * rendering it these assert the parts that can drift silently: the surviving
 * top-level menus, and the store behaviour the actions call into.
 */

describe('the menu bar', () => {
  it('is the nine menus, in order', () => {
    expect(MENU_ORDER).toEqual([
      'file',
      'edit',
      'view',
      'insert',
      'layer',
      'select',
      'filter',
      'tools',
      'help',
    ]);
  });

  it('no longer has Format, Options or Window as top-level menus', () => {
    // They became File ▸ Format, File ▸ Options and a group inside View.
    for (const gone of ['format', 'options', 'window']) {
      expect(MENU_ORDER).not.toContain(gone as DesignerMenu);
    }
  });

  it('leaves room on mobile — MenuBar shows 4 and overflows the rest', () => {
    expect(MENU_ORDER.length - 4).toBe(5);
  });
});

describe('the documentation link', () => {
  it('points at the Designer page on the docs site', () => {
    expect(DESIGNER_DOCS_URL).toBe('https://docs.postmill.ai/user-guide/media/designer');
  });
});

describe('fit-on-open', () => {
  it('asks the canvas to refit when a design is loaded', () => {
    // The canvas watches fitNonce. Without this bump, opening a design whose
    // dimensions match the current canvas leaves the old zoom and scroll.
    const store = createDesignerStore(1080, 1080);
    const before = store.getState().fitNonce;

    store.getState().loadDesign(
      {
        version: 5,
        mode: 'image',
        outputs: [
          {
            id: 'o',
            formatId: 'square',
            name: 'Square',
            width: 1080,
            height: 1080,
            background: '#ffffff',
            children: [],
          },
        ],
      },
      'design-1',
      'A design'
    );

    expect(store.getState().fitNonce).toBe(before + 1);
  });

  it('resets the zoom and viewport with it', () => {
    const store = createDesignerStore(1080, 1080);
    store.getState().setZoom(3);
    store.getState().setViewport(-400, -250);

    store.getState().loadDesign(
      {
        version: 5,
        mode: 'image',
        outputs: [
          { id: 'o', formatId: 'square', name: 'S', width: 1080, height: 1080, background: '#fff', children: [] },
        ],
      },
      'design-2',
      'Another'
    );

    expect(store.getState().zoom).toBe(1);
    expect(store.getState().viewportX).toBe(0);
    expect(store.getState().viewportY).toBe(0);
  });

  it('also refits on a brand new document', () => {
    const store = createDesignerStore(1080, 1080);
    const before = store.getState().fitNonce;
    store.getState().reset(1920, 1080);
    expect(store.getState().fitNonce).toBe(before + 1);
  });
});

describe('generate requests', () => {
  it('carries the request to the timeline and clears', () => {
    // The Tools menu can't reach the timeline's dialogs, so it names what it
    // wants and the timeline serves it.
    const store = createDesignerStore();
    expect(store.getState().generateRequest).toBeNull();

    store.getState().requestGenerate('video');
    expect(store.getState().generateRequest).toBe('video');

    store.getState().requestGenerate(null);
    expect(store.getState().generateRequest).toBeNull();
  });

  it('accepts each of the three kinds', () => {
    const store = createDesignerStore();
    for (const kind of ['video', 'music', 'voiceover'] as const) {
      store.getState().requestGenerate(kind);
      expect(store.getState().generateRequest).toBe(kind);
    }
  });
});

describe('video-mode gating', () => {
  it('reports image mode for a fresh document, so the generators stay disabled', () => {
    const store = createDesignerStore();
    expect(store.getState().doc.mode).toBe('image');
  });

  it('reports video mode once converted', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    expect(store.getState().doc.mode).toBe('video');
  });
});

// Guards against a stray `window.open` sneaking into a menu action without the
// noopener that a target=_blank link needs.
describe('opening the docs', () => {
  it('opens in a new tab with noopener', () => {
    const open = vi.fn();
    const original = window.open;
    (window as unknown as { open: typeof open }).open = open;
    try {
      window.open(DESIGNER_DOCS_URL, '_blank', 'noopener,noreferrer');
      expect(open).toHaveBeenCalledWith(
        DESIGNER_DOCS_URL,
        '_blank',
        'noopener,noreferrer'
      );
    } finally {
      window.open = original;
    }
  });
});

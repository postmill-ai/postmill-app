'use client';

import React, { useCallback, useRef } from 'react';
import { useDecisionModal, useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import type { DesignerElement, DesignerOutput } from './designer.store';
import { sharedStageRef } from './stage-ref';
import {
  ensureBuffer,
  getBuffer,
  pushUndoRegion,
  commitBuffer,
  seedBufferFromImage,
} from './raster-layers';
import {
  fullMask,
  invertMask,
  maskBounds,
  strokeBand,
  createMask,
  type SelectionMask,
} from './selection-mask';
import { fill, stroke } from '@postmill-ai/nestjs-libraries/media/designer-doc/fill-stroke';
import {
  FillDialog,
  StrokeDialog,
  type FillSettings,
  type StrokeSettings,
} from './fill-stroke-dialog';
import { FilterDialog } from './filter-dialog';
import { runFilter, blendThroughCoverage } from './filter-runner';
import {
  filterById,
  defaultFilterParams,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-descriptors';
import type { FilterParams } from '@postmill-ai/nestjs-libraries/media/designer-doc/filter-ops';

/**
 * The operations that act on PIXELS rather than on the document: the Select
 * menu, Edit ▸ Fill/Stroke, and the Filter menu.
 *
 * They live in one hook because they all need the same three things the action
 * layer cannot reach on its own — the Konva stage (to rasterize a layer), the
 * modals (to ask before rasterizing, and to collect parameters), and the raster
 * buffers (to write into, with undo).
 */

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

interface UsePixelOpsArgs {
  store: Store;
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
}

/** What a pixel operation runs against, once the target is resolved. */
export interface PixelTarget {
  element: DesignerElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

const activeOutput = (store: Store): DesignerOutput | undefined =>
  store.getState().doc.outputs[store.getState().currentOutput] as DesignerOutput | undefined;

/** Layer types whose pixels exist already — anything else must be rasterized. */
const RASTERIZED_TYPES = new Set(['raster', 'image', 'icon']);

const DEFAULT_FILL: FillSettings = {
  contents: 'color',
  color: '#000000',
  blendMode: 'normal',
  opacity: 1,
  preserveTransparency: false,
};

const DEFAULT_STROKE: StrokeSettings = {
  ...DEFAULT_FILL,
  width: 3,
  location: 'inside',
};

export const usePixelOps = ({ store, fetchFn }: UsePixelOpsArgs) => {
  const decision = useDecisionModal();
  const modals = useModals();
  const toaster = useToaster();
  const t = useT();

  // ── Select menu ──────────────────────────────────────────────────────────

  const onSelectAll = useCallback(() => {
    const out = activeOutput(store);
    if (!out) return;
    store.getState().setSelection(fullMask(out.width, out.height));
  }, [store]);

  const onSelectInverse = useCallback(() => {
    const current = store.getState().selection;
    if (!current) return;
    store.getState().setSelection(invertMask(current));
  }, [store]);

  // ── Target resolution ────────────────────────────────────────────────────

  /** The single selected layer, or undefined when the selection isn't one layer. */
  const selectedLayer = useCallback((): DesignerElement | undefined => {
    const st = store.getState();
    if (st.selectedIds.length !== 1) return undefined;
    return (activeOutput(store)?.children || []).find((c) => c.id === st.selectedIds[0]);
  }, [store]);

  const canEditPixels = useCallback(() => {
    const el = selectedLayer();
    return !!el && !el.locked && el.type !== 'group' && el.type !== 'adjustment';
  }, [selectedLayer]);

  /**
   * Rasterize a layer in place: capture what it currently draws, replace it with
   * a `raster` layer holding those pixels.
   *
   * Photoshop asks before doing this because it is destructive — the text stops
   * being text — so the caller must have confirmed first.
   */
  const rasterizeLayer = useCallback(
    (el: DesignerElement): HTMLCanvasElement | null => {
      const stage = sharedStageRef.current;
      if (!stage) return null;
      let node: ReturnType<typeof stage.findOne>;
      try {
        node = stage.findOne('#' + el.id);
      } catch {
        return null;
      }
      if (!node) return null;

      let captured: HTMLCanvasElement | null = null;
      try {
        captured = node.toCanvas({ pixelRatio: 1 } as never) as HTMLCanvasElement;
      } catch {
        // A tainted canvas (cross-origin image without CORS) can't be read back.
        return null;
      }
      if (!captured) return null;

      // Seed the buffer from the capture, then turn the layer into a raster one.
      // `src` stays empty until the operation commits and uploads.
      const buf = seedBufferFromImage(el.id, captured as never, el.width, el.height);
      store.getState().updateElement(el.id, {
        type: 'raster',
        src: undefined,
        fileId: undefined,
      });
      return buf;
    },
    [store]
  );

  /**
   * Resolve the layer a pixel operation should write into, rasterizing first if
   * that is what it takes and the user agrees.
   */
  const resolveTarget = useCallback(async (): Promise<PixelTarget | null> => {
    const el = selectedLayer();
    if (!el) {
      toaster.show(t('designer_select_a_layer_first', 'Select a layer first'), 'warning');
      return null;
    }

    let canvas: HTMLCanvasElement | null = null;

    if (RASTERIZED_TYPES.has(el.type)) {
      canvas = getBuffer(el.id) || null;
      if (!canvas) {
        // An image layer has pixels on screen but no buffer yet — capture them.
        canvas = rasterizeLayer(el);
      }
    } else {
      const ok = await decision.open({
        title: t('designer_rasterize_layer', 'Rasterize layer?'),
        description: t(
          'designer_rasterize_layer_body',
          'This layer must be rasterized before pixels can be edited. It will no longer be editable as {{type}}.',
          { type: el.type }
        ),
        approveLabel: t('designer_rasterize', 'Rasterize'),
      });
      if (!ok) return null;
      canvas = rasterizeLayer(el);
    }

    if (!canvas) {
      toaster.show(t('designer_couldnt_read_layer', "Couldn't read that layer's pixels"), 'warning');
      return null;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Re-read: rasterizing rewrote the element.
    const fresh = (activeOutput(store)?.children || []).find((c) => c.id === el.id) || el;
    return { element: fresh, canvas, ctx };
  }, [selectedLayer, decision, rasterizeLayer, store, toaster, t]);

  /**
   * The selection, resampled into the target layer's local pixel space.
   *
   * Masks are canvas-sized and layers are not, so this conversion has to happen
   * exactly once, here — every operation downstream then works in layer space
   * and never has to think about selections at all.
   */
  const coverageFor = useCallback(
    (target: PixelTarget): Uint8ClampedArray => {
      const { canvas, element } = target;
      const out = new Uint8ClampedArray(canvas.width * canvas.height);
      const selection: SelectionMask | null = store.getState().selection;

      if (!selection) {
        // No selection means the whole layer, which is what Photoshop does.
        out.fill(255);
        return out;
      }

      const scaleX = element.width / canvas.width;
      const scaleY = element.height / canvas.height;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const docX = Math.round(element.x + x * scaleX);
          const docY = Math.round(element.y + y * scaleY);
          out[y * canvas.width + x] =
            docX >= 0 && docY >= 0 && docX < selection.width && docY < selection.height
              ? selection.data[docY * selection.width + docX]
              : 0;
        }
      }
      return out;
    },
    [store]
  );

  /** The layer-local rect an operation can touch, for a bounded undo snapshot. */
  const dirtyRect = useCallback(
    (target: PixelTarget) => {
      const selection = store.getState().selection;
      const { canvas, element } = target;
      if (!selection) return { x: 0, y: 0, width: canvas.width, height: canvas.height };

      const bounds = maskBounds(selection);
      if (!bounds) return { x: 0, y: 0, width: canvas.width, height: canvas.height };

      const scaleX = canvas.width / Math.max(1, element.width);
      const scaleY = canvas.height / Math.max(1, element.height);
      const x = Math.max(0, Math.floor((bounds.x - element.x) * scaleX));
      const y = Math.max(0, Math.floor((bounds.y - element.y) * scaleY));
      return {
        x,
        y,
        width: Math.min(canvas.width - x, Math.ceil(bounds.width * scaleX) + 1),
        height: Math.min(canvas.height - y, Math.ceil(bounds.height * scaleY) + 1),
      };
    },
    [store]
  );

  /**
   * Run `mutate` over the target's pixels and persist the result.
   *
   * Every pixel operation funnels through here, so undo, upload and the history
   * entry are written once rather than in each command.
   */
  const applyToLayer = useCallback(
    async (
      mutate: (
        data: ImageData,
        coverage: Uint8ClampedArray,
        target: PixelTarget
      ) => void | Promise<void>
    ): Promise<boolean> => {
      const target = await resolveTarget();
      if (!target) return false;

      const rect = dirtyRect(target);
      pushUndoRegion(target.element.id, rect.x, rect.y, rect.width, rect.height);

      let data: ImageData;
      try {
        data = target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height);
      } catch {
        toaster.show(t('designer_couldnt_read_layer', "Couldn't read that layer's pixels"), 'warning');
        return false;
      }

      await mutate(data, coverageFor(target), target);
      target.ctx.putImageData(data, 0, 0);

      const result = await commitBuffer(target.element.id, fetchFn);
      if (result) {
        store.getState().updateElement(target.element.id, {
          src: result.src,
          fileId: result.fileId,
        });
      }
      store.getState().pushHistory();
      return true;
    },
    [resolveTarget, dirtyRect, coverageFor, fetchFn, store, toaster, t]
  );

  // ── Edit ▸ Fill / Stroke ─────────────────────────────────────────────────

  const onFill = useCallback(() => {
    modals.openModal({
      title: t('designer_fill', 'Fill'),
      children: (close: () => void) => (
        <FillDialog
          initial={DEFAULT_FILL}
          onClose={close}
          onApply={(settings) => {
            close();
            void applyToLayer((data, coverage) => {
              fill(data, coverage, settings);
            });
          }}
        />
      ),
    });
  }, [modals, t, applyToLayer]);

  const onStroke = useCallback(() => {
    modals.openModal({
      title: t('designer_stroke', 'Stroke'),
      children: (close: () => void) => (
        <StrokeDialog
          initial={DEFAULT_STROKE}
          onClose={close}
          onApply={(settings) => {
            close();
            void applyToLayer((data, coverage, target) => {
              // The band is derived from the coverage map, so a stroke with no
              // selection outlines the LAYER and one with a selection outlines
              // the ants — both without the stroke code knowing which.
              const asMask = createMask(target.canvas.width, target.canvas.height);
              asMask.data.set(coverage);
              const band = strokeBand(asMask, settings.width, settings.location);
              stroke(data, band.data, settings);
            });
          }}
        />
      ),
    });
  }, [modals, t, applyToLayer]);

  // ── Filter menu ──────────────────────────────────────────────────────────

  /**
   * Run a filter, blending the result back through the selection.
   *
   * The op sees the whole layer — clipping afterwards is what lets all 47
   * filters ignore selections entirely and still respect the marching ants,
   * including the ones (blur, distort) whose output depends on pixels just
   * outside the selection.
   */
  const applyFilterById = useCallback(
    async (id: string, params: FilterParams) => {
      const controller = new AbortController();
      await applyToLayer(async (data, coverage) => {
        const result = await runFilter(data, id, params, { signal: controller.signal });
        if (!result) return;
        blendThroughCoverage(data, result, coverage);
      });
      lastFilter.current = { id, params };
    },
    [applyToLayer]
  );

  /** What Filter ▸ Last Filter re-runs. */
  const lastFilter = useRef<{ id: string; params: FilterParams } | null>(null);

  const onFilter = useCallback(
    (id: string) => {
      const descriptor = filterById(id);
      if (!descriptor) return;
      const defaults = defaultFilterParams(id);

      // Photoshop applies the no-parameter filters straight from the menu.
      if (descriptor.immediate || descriptor.params.length === 0) {
        void applyFilterById(id, defaults);
        return;
      }

      modals.openModal({
        title: t(`designer_filter_${id}`, descriptor.label),
        children: (close: () => void) => (
          <FilterDialog
            descriptor={descriptor}
            initial={defaults}
            onCancel={close}
            onApply={(params) => {
              close();
              void applyFilterById(id, params);
            }}
          />
        ),
      });
    },
    [modals, t, applyFilterById]
  );

  const onLastFilter = useCallback(() => {
    const last = lastFilter.current;
    if (last) void applyFilterById(last.id, last.params);
  }, [applyFilterById]);

  const hasLastFilter = useCallback(() => !!lastFilter.current, []);

  const lastFilterLabel = useCallback(() => {
    const last = lastFilter.current;
    const label = last ? filterById(last.id)?.label : undefined;
    return label
      ? t('designer_last_filter_named', '{{name}}', { name: label })
      : t('designer_last_filter', 'Last Filter');
  }, [t]);

  return {
    onSelectAll,
    onSelectInverse,
    canEditPixels,
    onFill,
    onStroke,
    onFilter,
    onLastFilter,
    hasLastFilter,
    lastFilterLabel,
    applyToLayer,
    ensureBufferFor: ensureBuffer,
  };
};

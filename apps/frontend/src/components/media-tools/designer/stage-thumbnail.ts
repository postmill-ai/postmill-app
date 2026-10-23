/**
 * Stage-wide thumbnail capture for the designer.
 *
 * Konva renders ONE <canvas> per Layer inside the stage container, and video
 * frames are Konva Image nodes in OVERLAY layers (video-canvas-overlay). The
 * old `document.querySelector('.konva-stage canvas')` snapshot grabbed the
 * FIRST layer canvas only — the base layer — so a video-mode stage thumbnailed
 * as its (black) background. Compositing EVERY canvas in stacking (DOM) order
 * makes the thumbnail true WYSIWYG.
 *
 * CORS fail-soft: a cross-origin video/image without CORS headers taints every
 * canvas it was drawn to, and toDataURL on a tainted canvas throws a
 * SecurityError. `captureStageThumbnail` swallows that into `undefined` (no
 * client preview) — the server-side preview render is the backstop, so the
 * design thumbnail is still never black.
 */

export const getThumbnailDataUrl = (canvas: HTMLCanvasElement | null, maxDim = 400): string | undefined => {
  if (!canvas) return undefined;
  const ratio = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const w = Math.round(canvas.width * ratio);
  const h = Math.round(canvas.height * ratio);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.85);
};

/**
 * Composite every canvas inside the `.konva-stage` container onto a single
 * canvas at the stage's backing-store pixel size, in DOM (stacking) order.
 * Returns null when there is no stage or nothing measurable to composite.
 */
export const compositeStageCanvas = (): HTMLCanvasElement | null => {
  const stage = document.querySelector('.konva-stage');
  if (!stage) return null;
  const canvases = Array.from(stage.querySelectorAll('canvas'));
  if (!canvases.length) return null;
  const width = Math.max(...canvases.map((c) => c.width || 0));
  const height = Math.max(...canvases.map((c) => c.height || 0));
  if (!width || !height) return null;

  const composite = document.createElement('canvas');
  composite.width = width;
  composite.height = height;
  const ctx = composite.getContext('2d');
  if (!ctx) return null;

  const stageRect = stage.getBoundingClientRect();
  for (const canvas of canvases) {
    if (!canvas.width || !canvas.height) continue;
    const rect = canvas.getBoundingClientRect();
    if (stageRect.width && stageRect.height && rect.width && rect.height) {
      // Map each canvas's CSS box into the composite's pixel space — Konva
      // scales the backing store by the device pixel ratio.
      const scaleX = width / stageRect.width;
      const scaleY = height / stageRect.height;
      ctx.drawImage(
        canvas,
        (rect.left - stageRect.left) * scaleX,
        (rect.top - stageRect.top) * scaleY,
        rect.width * scaleX,
        rect.height * scaleY
      );
    } else {
      // Unmeasurable layout (e.g. jsdom): layer canvases share the stage
      // box, so a plain origin draw is correct.
      ctx.drawImage(canvas, 0, 0);
    }
  }
  return composite;
};

/**
 * The stage thumbnail as a JPEG data URL, or undefined when there is no
 * stage — or when a tainted (cross-origin) canvas makes the readback throw.
 * Never throws: preview capture must not gate the doc save on a thumbnail.
 */
export const captureStageThumbnail = (maxDim = 400): string | undefined => {
  try {
    return getThumbnailDataUrl(compositeStageCanvas(), maxDim);
  } catch {
    return undefined;
  }
};

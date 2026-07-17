// Pure, safe-zone-aware geometry reflow + focal-point estimation now live in
// the shared `designer-doc` layer so the server-side AI Composer can reuse them.
export {
  smartReflow,
  estimateFocalPoint,
  deriveAnchor,
  getSafeZoneInset,
} from '@gitroom/nestjs-libraries/media/designer-doc/reflow';
export type { Anchor } from '@gitroom/nestjs-libraries/media/designer-doc/reflow';

export const computeCoverCrop = (
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  focalPoint?: { x: number; y: number }
): { x: number; y: number; width: number; height: number } => {
  const fp = focalPoint || { x: 0.5, y: 0.5 };
  const targetRatio = targetW / targetH;
  const srcRatio = srcW / srcH;
  let sw: number;
  let sh: number;
  if (srcRatio > targetRatio) {
    sh = srcH;
    sw = srcH * targetRatio;
  } else {
    sw = srcW;
    sh = srcW / targetRatio;
  }
  const x = (srcW - sw) * Math.min(1, Math.max(0, fp.x));
  const y = (srcH - sh) * Math.min(1, Math.max(0, fp.y));
  return { x, y, width: sw, height: sh };
};

/**
 * Lightweight client-side focal-point detection.
 *
 * Downsamples the image, converts to grayscale, and computes the centroid of
 * the brightest pixels (subject/face highlight heuristic). Falls back to the
 * center if the image cannot be loaded or the canvas is tainted.
 */
export const detectFocalPointClient = (imageUrl: string): Promise<{ x: number; y: number }> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('Image' in window)) {
      resolve({ x: 0.5, y: 0.5 });
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    const fallback = () => {
      clearTimeout(timeout);
      resolve({ x: 0.5, y: 0.5 });
    };

    // Guard against environments (or CORS taint) where the image never fires.
    const timeout = setTimeout(fallback, 1000);

    img.onerror = fallback;

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        const maxDim = 200;
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

        const ctx = canvas.getContext('2d');
        if (!ctx) return fallback();

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        let totalBrightness = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          totalBrightness += lum;
          count++;
        }
        if (count === 0) return fallback();
        const mean = totalBrightness / count;
        const threshold = mean * 1.1;

        let weightedX = 0;
        let weightedY = 0;
        let weightSum = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (lum > threshold) {
              const w = lum - mean;
              weightedX += x * w;
              weightedY += y * w;
              weightSum += w;
            }
          }
        }

        if (weightSum === 0) return fallback();

        const x = weightedX / weightSum / canvas.width;
        let y = weightedY / weightSum / canvas.height;

        // For portrait photos, bias slightly toward the upper-center where faces
        // typically sit, while still honoring the detected centroid.
        if (img.naturalHeight > img.naturalWidth) {
          y = 0.25 + y * 0.5;
        }

        resolve({
          x: Math.min(1, Math.max(0, x)),
          y: Math.min(1, Math.max(0, y)),
        });
      } catch {
        fallback();
      }
    };

    img.src = imageUrl;
  });
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Provider-aware focal-point detection.
 *
 * When an authenticated fetcher is supplied, asks the backend to run a
 * vision-capable AI provider. If the provider returns a valid focal point,
 * use it. Otherwise — or if AI is not configured / the call fails — fall back
 * to the client-side brightness-centroid heuristic (which itself falls back to
 * center).
 */
export const detectFocalPoint = async (
  imageUrl: string,
  fetch?: FetchLike
): Promise<{ x: number; y: number }> => {
  if (fetch) {
    try {
      const res = await fetch('/media/detect-focal-point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          x?: number;
          y?: number;
          source?: 'provider' | 'fallback';
        };
        if (
          data.source === 'provider' &&
          typeof data.x === 'number' &&
          typeof data.y === 'number' &&
          !Number.isNaN(data.x) &&
          !Number.isNaN(data.y)
        ) {
          return {
            x: Math.min(1, Math.max(0, data.x)),
            y: Math.min(1, Math.max(0, data.y)),
          };
        }
      }
    } catch {
      // fall through to client heuristic
    }
  }
  return detectFocalPointClient(imageUrl);
};

'use client';

// `/files/import` deliberately rejects SVG, so stock vectors are rasterized
// before upload. Remote images must allow anonymous CORS for canvas export.
export async function rasterizeSvgUrlToPngBlob(url: string, size = 512): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image load failed'));
  });
  img.src = url;
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas context');

  const iw = img.naturalWidth || size;
  const ih = img.naturalHeight || size;
  const scale = Math.min(size / iw, size / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('rasterize failed'))),
      'image/png',
    ),
  );
}

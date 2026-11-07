import sharp from 'sharp';

export const compositeMagicGrabBackground = async ({
  original,
  generated,
  mask,
}: {
  original: Buffer;
  generated: Buffer;
  mask: Buffer;
}): Promise<Buffer> => {
  const metadata = await sharp(original).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error('The original image dimensions could not be read');

  const maskPixels = await sharp(mask)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < maskPixels.data.length; i += 4) {
    const luminance = Math.max(maskPixels.data[i], maskPixels.data[i + 1], maskPixels.data[i + 2]);
    maskPixels.data[i] = 255;
    maskPixels.data[i + 1] = 255;
    maskPixels.data[i + 2] = 255;
    maskPixels.data[i + 3] = Math.round(luminance * (maskPixels.data[i + 3] / 255));
  }
  const alphaMask = await sharp(maskPixels.data, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  const maskedGenerated = await sharp(generated)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .composite([{ input: alphaMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(original)
    .composite([{ input: maskedGenerated, blend: 'over' }])
    .png()
    .toBuffer();
};

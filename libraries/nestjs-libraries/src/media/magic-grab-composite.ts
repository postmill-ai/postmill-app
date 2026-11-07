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

  const [base, fill, alpha] = await Promise.all([
    sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(generated).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(mask).resize(width, height, { fit: 'fill' }).ensureAlpha().extractChannel(3).raw().toBuffer(),
  ]);
  const output = Buffer.from(base.data);
  for (let i = 0; i < output.length; i += 4) {
    const a = alpha[i / 4] / 255;
    if (a <= 0) continue;
    output[i] = Math.round(fill.data[i] * a + output[i] * (1 - a));
    output[i + 1] = Math.round(fill.data[i + 1] * a + output[i + 1] * (1 - a));
    output[i + 2] = Math.round(fill.data[i + 2] * a + output[i + 2] * (1 - a));
    output[i + 3] = Math.round(fill.data[i + 3] * a + output[i + 3] * (1 - a));
  }
  return sharp(output, { raw: { width, height, channels: 4 } }).png().toBuffer();
};

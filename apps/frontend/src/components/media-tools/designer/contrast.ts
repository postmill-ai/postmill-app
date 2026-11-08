const channels = (color: string): [number, number, number] | null => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!match) return null;
  return [
    parseInt(match[1], 16) / 255,
    parseInt(match[2], 16) / 255,
    parseInt(match[3], 16) / 255,
  ];
};

const luminance = (color: string): number | null => {
  const rgb = channels(color);
  if (!rgb) return null;
  const linear = rgb.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

export const getContrastRatio = (foreground: string, background: string): number | null => {
  const first = luminance(foreground);
  const second = luminance(background);
  if (first === null || second === null) return null;
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

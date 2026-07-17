export const hasExtension = (
  path: string | undefined | null,
  ...extensions: string[]
): boolean => {
  if (!path || extensions.length === 0) {
    return false;
  }
  const lowerPath = path.toLowerCase();
  return extensions.some((extension) => {
    const ext = extension.startsWith('.')
      ? extension.toLowerCase()
      : `.${extension.toLowerCase()}`;
    return lowerPath.endsWith(ext);
  });
};

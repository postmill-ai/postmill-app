export const trySetPointerCapture = (
  element: Element,
  pointerId: number
): boolean => {
  if (typeof element.setPointerCapture !== 'function') return false;
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
};

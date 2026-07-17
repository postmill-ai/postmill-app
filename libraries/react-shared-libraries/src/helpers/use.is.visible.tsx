'use client';

import { useEffect, useState } from 'react';
export function usePageVisibility(page: number) {
  const [isVisible, setIsVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden
  );
  useEffect(() => {
    if (page > 1) {
      return;
    }
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };
    const onBlur = () => {
      setIsVisible(false);
    };
    const onFocus = () => {
      setIsVisible(true);
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [page]);
  return isVisible;
}

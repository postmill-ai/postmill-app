'use client';

import { useSearchParams } from 'next/navigation';
import { FC, useCallback, useEffect } from 'react';
const ReturnUrlComponent: FC = () => {
  const params = useSearchParams();
  const url = params.get('returnUrl');
  useEffect(() => {
    try {
      // Resolved against our own origin so a relative returnUrl is honoured
      // rather than throwing into the catch below and vanishing; the origin
      // check still rejects an absolute off-site value.
      const parsed = new URL(url!, window.location.origin);
      if (parsed.origin === window.location.origin) {
        localStorage.setItem('returnUrl', url!);
      }
    } catch {
    }
  }, [url]);
  return null;
};
export const useReturnUrl = () => {
  return {
    getAndClear: useCallback(() => {
      const data = localStorage.getItem('returnUrl');
      localStorage.removeItem('returnUrl');
      return data;
    }, []),
  };
};
export default ReturnUrlComponent;

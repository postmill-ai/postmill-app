'use client';

import { useSearchParams } from 'next/navigation';
import { FC, useCallback, useEffect } from 'react';
const ReturnUrlComponent: FC = () => {
  const params = useSearchParams();
  const url = params.get('returnUrl');
  useEffect(() => {
    try {
      const parsed = new URL(url!);
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

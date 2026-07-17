'use client';

import { useEffect, useState } from 'react';

// Persisted collapse state for the secondary left sidebars (/media, /settings).
// Defaults to expanded on the server and first paint to avoid a hydration
// mismatch, then hydrates the stored preference from localStorage.
export const useSidebarCollapse = (storageKey: string) => {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(storageKey) === '1');
    } catch {
      /* localStorage unavailable — keep the default */
    }
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  return { collapsed, toggle };
};

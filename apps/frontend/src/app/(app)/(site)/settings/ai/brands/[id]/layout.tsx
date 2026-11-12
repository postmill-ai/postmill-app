'use client';

import { useEffect } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';

export default function LegacyBrandEditLayout(): null {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    router.replace(pathname.replace('/settings/ai/brands', '/brands'));
  }, [pathname, router, params.id]);
  return null;
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Page(): null {
  const router = useRouter();
  useEffect(() => {
    router.replace('/brands');
  }, [router]);
  return null;
}

'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function Page(): null {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  useEffect(() => {
    if (params?.id) router.replace(`/brands/${params.id}/voice`);
  }, [router, params?.id]);
  return null;
}

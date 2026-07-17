'use client';

import { FC, useEffect } from 'react';
import { useRouter } from 'next/navigation';
export const Redirect: FC<{
  url: string;
  delay: number;
}> = (props) => {
  const { url, delay } = props;
  const router = useRouter();
  useEffect(() => {
    const timeout = setTimeout(() => {
      router.push(url);
    }, delay);
    return () => clearTimeout(timeout);
  }, [url, delay, router]);
  return null;
};

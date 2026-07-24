'use client';

import dynamicLoad from 'next/dynamic';

const ChangeDirComponent = dynamicLoad(
  () =>
    import('@postmill-ai/frontend/components/new-layout/change.dir').then(
      (mod) => mod.ChangeDir
    ),
  {
    ssr: false,
  }
);

export const ChangeDirClient = () => {
  return <ChangeDirComponent />;
};

'use client';

import { useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { LoadingComponent } from '@postmill-ai/frontend/components/layout/loading';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { MainBillingComponent } from './main.billing.component';
export const BillingComponent = () => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, [fetch]);
  const { isLoading: isLoadingTier, data: tiers } = useSWR(
    '/user/subscription/tiers',
    load
  );
  const { isLoading: isLoadingSubscription, data: subscription } = useSWR(
    '/user/subscription',
    load
  );
  if (isLoadingSubscription || isLoadingTier) {
    return <LoadingComponent />;
  }
  return <MainBillingComponent sub={subscription?.subscription} />;
};

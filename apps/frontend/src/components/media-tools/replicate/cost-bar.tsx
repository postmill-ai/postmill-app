'use client';

import React, { useEffect, useRef } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useReplicateStore, EstimateResult } from './replicate.store';

const ENHANCE_SURCHARGE = 0.1; // oc-platform: $0.10 per enabled prompt enhancement

function useEstimate(modelId: string | undefined, input: Record<string, unknown>) {
  const fetch = useFetch();
  return useSWR(
    modelId ? `replicate-estimate-${modelId}-${JSON.stringify(input)}` : null,
    async () => {
      const res = await fetch('/media/replicate/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, input }),
      });
      return (await res.json()) as EstimateResult;
    },
    { revalidateOnFocus: false, dedupingInterval: 2000 }
  );
}

export function CostBar() {
  const t = useT();
  // Individual slice selectors — whole-store subscription loops the setEstimate effect.
  const formInput = useReplicateStore((s) => s.formInput);
  const selectedModel = useReplicateStore((s) => s.selectedModel);
  const setEstimate = useReplicateStore((s) => s.setEstimate);
  const storedEstimate = useReplicateStore((s) => s.estimate);
  const enhanceFlags = useReplicateStore((s) => s.enhanceFlags);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);
  const inputRef = useRef(formInput);
  const [debouncedInput, setDebouncedInput] = React.useState(formInput);

  useEffect(() => {
    inputRef.current = formInput;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedInput(inputRef.current), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [formInput]);

  const { data: estimate } = useEstimate(selectedModel?.id, debouncedInput);

  useEffect(() => {
    if (estimate) setEstimate(estimate);
  }, [estimate, setEstimate]);

  if (!selectedModel) return null;

  const enhanceCount = Object.values(enhanceFlags).filter(Boolean).length;
  const surcharge = enhanceCount * ENHANCE_SURCHARGE;

  let body: React.ReactNode;
  if (!storedEstimate) {
    body = <span className="text-xs text-newTextColor/65">{t('estimating', 'Estimating…')}</span>;
  } else if (storedEstimate.approximate) {
    body = (
      <span className="text-xs text-newTextColor/70">
        {t('billed_by_usage', 'Billed by usage')}
        {surcharge > 0 && (
          <>
            {' '}
            {t('surcharge_enhance_note', '· + ${{amount}} enhance', { amount: surcharge.toFixed(2) })}
          </>
        )}
      </span>
    );
  } else {
    const total = storedEstimate.usd + surcharge;
    body = (
      <span className="text-sm text-newTextColor/80">
        {t('estimated_cost', 'Estimated cost')}{' '}
        <span className="text-textColor font-semibold">${total.toFixed(4)}</span>
        {surcharge > 0 && (
          <span className="text-[10px] text-newTextColor/65">
            {' '}
            {t('incl_enhance_note', '(incl. ${{amount}} enhance)', { amount: surcharge.toFixed(2) })}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-studioBorder bg-newBgColorInner px-3 py-2.5">
      {body}
    </div>
  );
}

'use client';

import { FC, ReactNode, useEffect, useState } from 'react';
import Loading from '@postmill-ai/frontend/components/layout/loading';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { timer } from '@postmill-ai/helpers/utils/timer';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
export const CheckPayment: FC<{
  check: string;
  /** The provider's own subscription ref from the return URL (PayPal appends `subscription_id`). */
  providerRef?: string;
  mutate: () => void;
  children: ReactNode;
}> = (props) => {
  if (!props.check) {
    return <>{props.children}</>;
  }
  return <CheckPaymentInner {...props} />;
};

export const CheckPaymentInner: FC<{
  check: string;
  providerRef?: string;
  mutate: () => void;
  children: ReactNode;
}> = ({ check, providerRef, mutate, children }) => {
  const [showLoader, setShowLoader] = useState(true);
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useDecisionModal();
  const t = useT();

  useEffect(() => {
    if (showLoader) {
      document.querySelector('body')?.classList.add('overflow-hidden');
      Array.from(document.querySelectorAll('.blurMe') || []).map((p) =>
        p.classList.add('blur-xs', 'pointer-events-none')
      );
    } else {
      document.querySelector('body')?.classList.remove('overflow-hidden');
      Array.from(document.querySelectorAll('.blurMe') || []).map((p) =>
        p.classList.remove('blur-xs', 'pointer-events-none')
      );
    }
  }, [showLoader]);

  useEffect(() => {
    let mounted = true;
    // Bounded: vendor webhooks can lag the redirect (PayPal by minutes), but a
    // loader that never ends is worse than asking the user to check back.
    let attempts = 0;
    const MAX_ATTEMPTS = 90;

    const giveUp = () => {
      modal.open({
        title: t('billing_still_processing', 'Payment still processing'),
        onlyApprove: true,
        approveLabel: t('ok', 'OK'),
        description: t(
          'billing_still_processing_description',
          'We have not received confirmation from the payment provider yet. Your subscription will appear once it lands — please check back in a few minutes.'
        ),
      });
      setShowLoader(false);
    };

    const checkSubscription = async (): Promise<void> => {
      let status: number;
      try {
        ({ status } = await (
          await fetch('/billing/check/' + check + (providerRef ? `?ref=${encodeURIComponent(providerRef)}` : ''))
        ).json());
      } catch {
        if (!mounted) return;
        return giveUp();
      }
      if (!mounted) return;
      if (status === 0) {
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          return giveUp();
        }
        await timer(1000);
        return checkSubscription();
      }
      if (status === 1) {
        modal.open({
          title: t('invalid_payment', 'Invalid Payment'),
          onlyApprove: true,
          approveLabel: t('ok', 'OK'),
          description: t(
            'could_not_validate_payment_method',
            'We could not validate your payment method, please try again'
          ),
        });
        setShowLoader(false);
      }
      if (status === 2) {
        setShowLoader(false);
        mutate();
      }
    };

    checkSubscription();

    return () => {
      mounted = false;
    };
  }, [fetch, modal, check, providerRef, mutate, t]);
  if (showLoader) {
    return (
      <div className="fixed bg-black/40 w-full h-full flex justify-center items-center z-400">
        <div>
          <Loading type="spin" color="#2b5cd3" height={250} width={250} />
        </div>
      </div>
    );
  }
  return <>{children}</>;
};

import { usePlausible } from 'next-plausible';
import { useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { useVariables } from '@postmill-ai/react/helpers/variable.context';
import { useUser } from '@postmill-ai/frontend/components/layout/user.context';

export const useFireEvents = () => {
  const { billingEnabled } = useVariables();
  const plausible = usePlausible();
  const posthog = usePostHog();
  const user = useUser();

  return useCallback(
    (name: string, props?: Record<string, unknown>) => {
      if (!billingEnabled) {
        return;
      }

      if (user) {
        posthog.identify(user.id, { email: user.email, name: user.profile?.name });
      }

      posthog.capture(name, props);
      plausible(name, { props });
    },
    [user, billingEnabled, plausible, posthog]
  );
};

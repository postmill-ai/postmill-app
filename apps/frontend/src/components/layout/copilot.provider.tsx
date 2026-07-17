'use client';

import { FC, ReactNode } from 'react';
import { CopilotKit } from '@copilotkit/react-core';
import { csrfHeader } from '@gitroom/helpers/utils/csrf.header';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useAiActive } from '@gitroom/frontend/components/layout/use-ai-active';

/**
 * Mounts the CopilotKit runtime provider ONLY when the org has an active AI
 * provider. When AI is off (or still resolving), it renders children without a
 * provider so CopilotKit never fires its runtime-info handshake — that POST to
 * the CSRF-protected /copilot/chat 403s when the token isn't on the request and
 * cascades into `runtime_info_fetch_failed` / "Agent default not found" /
 * `_?.filter is not a function` console errors on every page (v3.6.2 regression).
 *
 * Consumers of CopilotKit hooks on always-rendered pages (the composer's
 * editor + platform picker) are gated behind the same `useAiActive()` signal so
 * they never call the hooks without a provider — see copilot-bridges.tsx.
 */
export const CopilotProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { backendUrl } = useVariables();
  const aiActive = useAiActive();

  if (!aiActive) {
    return <>{children}</>;
  }

  return (
    <CopilotKit
      credentials="include"
      runtimeUrl={backendUrl + '/copilot/chat'}
      headers={csrfHeader()}
      showDevConsole={false}
    >
      {children}
    </CopilotKit>
  );
};

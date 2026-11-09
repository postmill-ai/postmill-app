'use client';

import { EmptyState } from '@postmill-ai/frontend/components/ui/empty-state';
import { LogoutComponent } from '@postmill-ai/frontend/components/layout/logout.component';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export default function NoWorkspacePage() {
  const t = useT();

  return (
    <main className="min-h-[60vh] flex items-center justify-center p-[24px]">
      <div className="w-full max-w-[480px]">
        <EmptyState
          title={t('no_workspace_title', 'No active workspace')}
          description={t(
            'no_workspace_description',
            'You are not a member of an active workspace. Ask a workspace owner to send you a new invitation, or sign out and use a different account.'
          )}
          action={<LogoutComponent />}
        />
      </div>
    </main>
  );
}

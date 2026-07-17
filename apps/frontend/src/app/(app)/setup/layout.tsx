import { SetupShell } from '@gitroom/frontend/components/setup/setup-shell';
import { ReactNode } from 'react';

export default function SetupLayout({ children }: { children: ReactNode }) {
  return <SetupShell>{children}</SetupShell>;
}

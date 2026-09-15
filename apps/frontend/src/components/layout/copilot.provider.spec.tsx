import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const copilotKitProps = vi.fn();
let aiActive: boolean | null = true;

vi.mock('@copilotkit/react-core', () => ({
  CopilotKit: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
    copilotKitProps(props);
    return <div data-testid="copilotkit">{children}</div>;
  },
}));
vi.mock('@postmill-ai/helpers/utils/csrf.header', () => ({
  csrfHeader: () => ({ 'x-csrf-token': 'tok' }),
}));
vi.mock('@postmill-ai/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: 'https://api.example' }),
}));
vi.mock('@postmill-ai/frontend/components/layout/use-ai-active', () => ({
  useAiActive: () => aiActive,
}));

import { CopilotProvider } from './copilot.provider';

describe('CopilotProvider', () => {
  beforeEach(() => {
    copilotKitProps.mockClear();
    aiActive = true;
  });

  it('mounts CopilotKit in single-endpoint mode against /copilot/chat', () => {
    render(
      <CopilotProvider>
        <span>child</span>
      </CopilotProvider>
    );
    expect(screen.getByTestId('copilotkit').textContent).toBe('child');
    expect(copilotKitProps).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeUrl: 'https://api.example/copilot/chat',
        // The backend serves CopilotKit's single-route (POST-only) transport;
        // without this the client probes GET /copilot/chat/info and 404s.
        useSingleEndpoint: true,
        credentials: 'include',
        headers: { 'x-csrf-token': 'tok' },
        showDevConsole: false,
        enableInspector: false,
      })
    );
  });

  it.each([false, null])('renders children without a provider when AI is %s', (state) => {
    aiActive = state;
    render(
      <CopilotProvider>
        <span>child</span>
      </CopilotProvider>
    );
    expect(screen.getByText('child')).toBeTruthy();
    expect(screen.queryByTestId('copilotkit')).toBeNull();
    expect(copilotKitProps).not.toHaveBeenCalled();
  });
});

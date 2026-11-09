import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NoWorkspacePage from './page';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@postmill-ai/frontend/components/layout/logout.component', () => ({
  LogoutComponent: () => <button type="button">Sign out</button>,
}));

describe('NoWorkspacePage', () => {
  it('renders workspace guidance and session-revoking logout', () => {
    render(<NoWorkspacePage />);

    expect(screen.getByText('No active workspace')).toBeTruthy();
    expect(
      screen.getByText(/Ask a workspace owner to send you a new invitation/)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

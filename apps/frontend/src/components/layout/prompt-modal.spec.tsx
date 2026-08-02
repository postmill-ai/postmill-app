import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FC, useState } from 'react';

const mockT = vi.fn((_key: string, fallback?: string) => fallback ?? _key);

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => mockT,
}));

vi.mock('@postmill-ai/react/translation/i18next', () => ({
  default: { t: (_key: string, fallback?: string) => fallback ?? _key },
}));

import {
  ModalManager,
  usePromptModal,
} from '@postmill-ai/frontend/components/layout/new-modal';

// `usePromptModal` is the app's replacement for the native `prompt()`. The
// contract that matters to callers is the resolved value: a trimmed string on
// submit (including `''`) versus `null` on cancel/dismiss — both Tiptap link
// buttons branch on exactly that distinction to tell "clear the link" from
// "leave the link alone".
const Harness: FC<{ initialValue?: string }> = ({ initialValue = '' }) => {
  const prompt = usePromptModal();
  // `undefined` = not resolved yet; JSON keeps null/'' distinguishable in the DOM.
  const [result, setResult] = useState<string | null | undefined>(undefined);
  return (
    <div>
      <button
        type="button"
        onClick={async () => setResult(await prompt.open({ initialValue }))}
      >
        open
      </button>
      {result !== undefined && (
        <span data-testid="result">{JSON.stringify(result)}</span>
      )}
    </div>
  );
};

const renderHarness = (initialValue?: string) =>
  render(
    <ModalManager>
      <Harness initialValue={initialValue} />
    </ModalManager>
  );

const openPrompt = async () => {
  fireEvent.click(screen.getByText('open'));
  return waitFor(() => screen.getByRole('dialog'));
};

describe('usePromptModal', () => {
  afterEach(() => {
    // The modal store is module-level zustand state — leaving a modal mounted
    // would leak the dialog into the next test.
    const close = screen
      .queryAllByRole('dialog')
      .map((d) => d.querySelector<HTMLButtonElement>('.mantine-Modal-close'));
    close.forEach((b) => b?.click());
  });

  it('resolves the trimmed value on submit', async () => {
    renderHarness();
    await openPrompt();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  https://example.com  ' },
    });
    fireEvent.click(screen.getByText('OK'));

    await waitFor(() =>
      expect(screen.getByTestId('result').textContent).toBe(
        '"https://example.com"'
      )
    );
  });

  it('resolves an empty string when submitted empty, not null', async () => {
    // Load-bearing: callers treat '' as "unset the link" and null as "abort".
    renderHarness('https://example.com');
    await openPrompt();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(screen.getByText('OK'));

    await waitFor(() =>
      expect(screen.getByTestId('result').textContent).toBe('""')
    );
  });

  it('prefills initialValue and submits on Enter', async () => {
    renderHarness('https://prefilled.example');
    await openPrompt();

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('https://prefilled.example');

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getByTestId('result').textContent).toBe(
        '"https://prefilled.example"'
      )
    );
  });

  it('resolves null when cancelled', async () => {
    renderHarness('https://example.com');
    await openPrompt();

    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() =>
      expect(screen.getByTestId('result').textContent).toBe('null')
    );
  });

  it('resolves null when dismissed via the close button', async () => {
    renderHarness('https://example.com');
    const dialog = await openPrompt();

    fireEvent.click(dialog.querySelector('.mantine-Modal-close')!);

    await waitFor(() =>
      expect(screen.getByTestId('result').textContent).toBe('null')
    );
  });
});

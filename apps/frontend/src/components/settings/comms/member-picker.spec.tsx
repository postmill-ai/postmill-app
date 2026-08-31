import { render, screen, fireEvent } from '@testing-library/react';
import { MemberPicker } from './member-picker';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

const members = [
  { id: 'u1', email: 'maya@solstice.demo', name: 'Maya', roleKey: 'owner', disabled: false },
  { id: 'u2', email: 'sam@solstice.demo', name: 'Sam', roleKey: 'member', disabled: false },
  { id: 'u3', email: 'gone@solstice.demo', name: 'Gone', roleKey: 'member', disabled: true },
];

describe('MemberPicker', () => {
  it('lists only active members and selects on click', () => {
    const onChange = vi.fn();
    render(<MemberPicker members={members} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('member-picker-toggle'));
    expect(screen.getByTestId('member-option-u1')).toBeDefined();
    expect(screen.getByTestId('member-option-u2')).toBeDefined();
    expect(screen.queryByTestId('member-option-u3')).toBeNull();

    fireEvent.click(screen.getByTestId('member-option-u2'));
    expect(onChange).toHaveBeenCalledWith('u2');
  });

  it('filters by name, email, and role', () => {
    render(<MemberPicker members={members} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('member-picker-toggle'));

    const filter = screen.getByPlaceholderText('Filter by name, email, or role');
    fireEvent.change(filter, { target: { value: 'maya' } });
    expect(screen.getByTestId('member-option-u1')).toBeDefined();
    expect(screen.queryByTestId('member-option-u2')).toBeNull();

    fireEvent.change(filter, { target: { value: 'member' } });
    expect(screen.getByTestId('member-option-u2')).toBeDefined();
    expect(screen.queryByTestId('member-option-u1')).toBeNull();

    fireEvent.change(filter, { target: { value: 'zzz' } });
    expect(screen.getByText('No members match')).toBeDefined();
  });

  it('shows the selected member on the toggle', () => {
    render(<MemberPicker members={members} value="u1" onChange={vi.fn()} />);
    expect(screen.getByTestId('member-picker-toggle').textContent).toContain('Maya');
    expect(screen.getByTestId('member-picker-toggle').textContent).toContain(
      'maya@solstice.demo',
    );
  });
});

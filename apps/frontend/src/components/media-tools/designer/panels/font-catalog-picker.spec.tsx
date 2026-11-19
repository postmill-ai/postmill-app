import { fireEvent, render, screen } from '@testing-library/react';
import { FontCatalogPicker } from './font-catalog-picker';
import { ensureFontLoaded } from '../fonts';

vi.mock('../fonts', () => ({
  DESIGNER_FONTS: [
    { family: 'Inter', label: 'Inter', weights: [400, 700], category: 'sans-serif' },
  ],
  ensureFontLoaded: vi.fn(() => Promise.resolve()),
}));

vi.mock('@postmill-ai/nestjs-libraries/media/designer-doc/font-catalog', () => ({
  GOOGLE_FONTS: [
    { family: 'Alegreya', weights: [400, 700], category: 'serif' },
    { family: 'Inter', weights: [400, 700], category: 'sans-serif' },
  ],
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

describe('FontCatalogPicker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows recommended and uploaded fonts with real family previews', () => {
    render(
      <FontCatalogPicker
        value=""
        placeholder="Add a font"
        onPick={vi.fn()}
        customFonts={[{ fileId: 'font-1', family: 'Uploaded Sans', path: '/font.ttf', weights: [400] }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add a font' }));
    expect(screen.getByRole('button', { name: 'Inter' }).style.fontFamily).toBe('"Inter"');
    expect(screen.getByRole('button', { name: 'Uploaded Sans' }).style.fontFamily).toBe('"Uploaded Sans"');
    expect(screen.queryByRole('button', { name: 'Alegreya' })).toBeNull();
    expect(ensureFontLoaded).toHaveBeenCalledWith('Inter', [400]);
    expect(ensureFontLoaded).toHaveBeenCalledWith('Uploaded Sans', [400]);
  });

  it('searches the full Designer catalog and returns the picked family', () => {
    const onPick = vi.fn();
    render(<FontCatalogPicker value="" placeholder="Add a font" onPick={onPick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add a font' }));
    fireEvent.change(screen.getByPlaceholderText('Search fonts...'), { target: { value: 'aleg' } });
    const result = screen.getByRole('button', { name: 'Alegreya' });
    expect(result.style.fontFamily).toBe('"Alegreya"');
    fireEvent.click(result);

    expect(onPick).toHaveBeenCalledWith('Alegreya');
    expect(ensureFontLoaded).toHaveBeenCalledWith('Alegreya');
  });

  it('marks existing Brand Kit selections without excluding legacy values', () => {
    render(
      <FontCatalogPicker
        value="Legacy Sans"
        onPick={vi.fn()}
        selectedFamilies={['Inter', 'Legacy Sans']}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Legacy Sans' }));
    expect(screen.getByRole('button', { name: 'Inter' }).getAttribute('aria-pressed')).toBe('true');
  });
});

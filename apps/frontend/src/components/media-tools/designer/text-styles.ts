export interface TextStylePreset {
  name: string;
  category: 'heading' | 'subheading' | 'body' | 'caption';
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  fill?: string;
}

export const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  {
    name: 'Heading 1',
    category: 'heading',
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: -1,
  },
  {
    name: 'Heading 2',
    category: 'heading',
    fontFamily: 'Inter',
    fontSize: 36,
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: -0.5,
  },
  {
    name: 'Subheading',
    category: 'subheading',
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: 600,
    lineHeight: 1.3,
    letterSpacing: 0,
  },
  {
    name: 'Body',
    category: 'body',
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.5,
    letterSpacing: 0,
  },
  {
    name: 'Body Small',
    category: 'body',
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.5,
    letterSpacing: 0,
  },
  {
    name: 'Caption',
    category: 'caption',
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: 0.5,
  },
];

export interface FontPairing {
  name: string;
  heading: TextStylePreset;
  body: TextStylePreset;
}

export const FONT_PAIRINGS: FontPairing[] = [
  {
    name: 'Editorial',
    heading: { name: 'Editorial Heading', category: 'heading', fontFamily: 'Playfair Display', fontSize: 48, fontWeight: 700, lineHeight: 1.1, letterSpacing: -0.5 },
    body: { name: 'Editorial Body', category: 'body', fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: 1.55, letterSpacing: 0 },
  },
  {
    name: 'Modern',
    heading: { name: 'Modern Heading', category: 'heading', fontFamily: 'Montserrat', fontSize: 44, fontWeight: 800, lineHeight: 1.1, letterSpacing: -0.5 },
    body: { name: 'Modern Body', category: 'body', fontFamily: 'Open Sans', fontSize: 16, fontWeight: 400, lineHeight: 1.55, letterSpacing: 0 },
  },
  {
    name: 'Classic',
    heading: { name: 'Classic Heading', category: 'heading', fontFamily: 'Merriweather', fontSize: 42, fontWeight: 700, lineHeight: 1.2, letterSpacing: 0 },
    body: { name: 'Classic Body', category: 'body', fontFamily: 'Lato', fontSize: 16, fontWeight: 400, lineHeight: 1.6, letterSpacing: 0 },
  },
  {
    name: 'Friendly',
    heading: { name: 'Friendly Heading', category: 'heading', fontFamily: 'Poppins', fontSize: 46, fontWeight: 700, lineHeight: 1.15, letterSpacing: -0.5 },
    body: { name: 'Friendly Body', category: 'body', fontFamily: 'Nunito', fontSize: 16, fontWeight: 400, lineHeight: 1.55, letterSpacing: 0 },
  },
  {
    name: 'Bold',
    heading: { name: 'Bold Heading', category: 'heading', fontFamily: 'Bebas Neue', fontSize: 60, fontWeight: 400, lineHeight: 1.05, letterSpacing: 1 },
    body: { name: 'Bold Body', category: 'body', fontFamily: 'Roboto', fontSize: 16, fontWeight: 400, lineHeight: 1.55, letterSpacing: 0 },
  },
  {
    name: 'Tech',
    heading: { name: 'Tech Heading', category: 'heading', fontFamily: 'Inter', fontSize: 42, fontWeight: 700, lineHeight: 1.15, letterSpacing: -0.5 },
    body: { name: 'Tech Body', category: 'body', fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 400, lineHeight: 1.6, letterSpacing: 0 },
  },
  {
    name: 'Elegant',
    heading: { name: 'Elegant Heading', category: 'heading', fontFamily: 'Cormorant Garamond', fontSize: 52, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.5 },
    body: { name: 'Elegant Body', category: 'body', fontFamily: 'Source Sans 3', fontSize: 16, fontWeight: 400, lineHeight: 1.55, letterSpacing: 0 },
  },
];

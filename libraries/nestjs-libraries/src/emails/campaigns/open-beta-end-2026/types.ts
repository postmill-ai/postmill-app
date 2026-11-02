import type { SupportedLanguage } from '@postmill-ai/helpers/translation/languages';

export interface OpenBetaEndContent {
  locale: SupportedLanguage;
  direction: 'ltr' | 'rtl';
  subject: string;
  greeting: string;
  introduction: { text: string; emphasis?: boolean }[];
  progressTitle: string;
  progress: string[];
  progressClosing: string[];
  highlights: { title: string; text: string }[];
  changesTitle: string;
  changes: { text: string; emphasis?: boolean }[];
  trialFacts: string[];
  trialNote: string;
  finalTitle: string;
  finalParagraphs: { text: string; emphasis?: boolean }[];
  bestRegards: string;
  role: string;
  notificationPreferences: {
    before: string;
    link: string;
    after: string;
  };
}

export interface RenderedOpenBetaEndEmail {
  subject: string;
  html: string;
  text: string;
  locale: SupportedLanguage;
  direction: 'ltr' | 'rtl';
  notificationPreferences: OpenBetaEndContent['notificationPreferences'];
}

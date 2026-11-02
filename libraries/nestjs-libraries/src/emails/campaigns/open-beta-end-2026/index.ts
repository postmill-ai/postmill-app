import { en } from './locales/en';
import { renderOpenBetaEndEmail } from './renderer';

export const OPEN_BETA_END_CAMPAIGN_ID = 'open-beta-end-2026-11';
export const OPEN_BETA_END_CONFIRMATION = 'SEND_OPEN_BETA_END_2026_11_09';

export const getOpenBetaEndEmail = () => renderOpenBetaEndEmail(en);

export type { RenderedOpenBetaEndEmail } from './types';

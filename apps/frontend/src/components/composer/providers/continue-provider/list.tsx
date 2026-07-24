'use client';

import { InstagramContinue } from '@postmill-ai/frontend/components/composer/providers/continue-provider/instagram/instagram.continue';
import { FacebookContinue } from '@postmill-ai/frontend/components/composer/providers/continue-provider/facebook/facebook.continue';
import { LinkedinContinue } from '@postmill-ai/frontend/components/composer/providers/continue-provider/linkedin/linkedin.continue';
import { GmbContinue } from '@postmill-ai/frontend/components/composer/providers/continue-provider/gmb/gmb.continue';
import { YoutubeContinue } from '@postmill-ai/frontend/components/composer/providers/continue-provider/youtube/youtube.continue';

export const continueProviderList = {
  instagram: InstagramContinue,
  facebook: FacebookContinue,
  'linkedin-page': LinkedinContinue,
  gmb: GmbContinue,
  youtube: YoutubeContinue,
};

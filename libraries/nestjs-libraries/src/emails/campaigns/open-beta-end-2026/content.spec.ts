import { describe, expect, it } from 'vitest';
import { getOpenBetaEndEmail, OPEN_BETA_END_CAMPAIGN_ID } from './index';
import { en } from './locales/en';

describe('open-beta announcement content', () => {
  it('uses the supplied English subject and preserves the full copy structure', () => {
    expect(OPEN_BETA_END_CAMPAIGN_ID).toBe('open-beta-end-2026-11');
    expect(en.subject).toBe('Postmill AI Is Moving Beyond Open Beta — Thank You!');
    expect(en.introduction).toHaveLength(4);
    expect(en.highlights).toHaveLength(5);
    expect(en.trialFacts).toHaveLength(4);
    expect(en.finalParagraphs).toHaveLength(4);
  });

  it('renders the English HTML and plain-text bodies with all campaign facts', () => {
    const email = getOpenBetaEndEmail();
    expect(email.locale).toBe('en');
    expect(email.direction).toBe('ltr');
    for (const required of [
      'Monday, November 9, 2026',
      '30-day free trial',
      '46 built-in media tools',
      '.pdesign',
      'Rick Somers',
      'Founder & Principal AI Architect',
      'https://postmill.ai',
    ]) {
      expect(email.text).toContain(required);
    }
    expect(email.text.indexOf('A dramatically enhanced Designer')).toBeLessThan(
      email.text.indexOf("And that's just a small sample")
    );
    expect(email.text.indexOf("And that's just a small sample")).toBeLessThan(
      email.text.indexOf("What's Changing on November 9?")
    );
    expect(email.html).toContain('<h2');
    expect(email.html).toContain('<ul');
    expect(email.html).toContain('https://postmill.ai');
    expect(email.html).toContain('<code>.pdesign</code>');
    expect(email.html).not.toContain('undefined');
    expect(email.text).not.toContain('undefined');
  });

  it('keeps the exact trial terms and English notification footer', () => {
    const email = getOpenBetaEndEmail();
    expect(email.text).toContain('Your first 30 days are free, beginning when you activate your trial.');
    expect(email.text).toContain("You won't be charged during your free-trial period.");
    expect(email.text).toContain('Your existing account and work will remain in place.');
    expect(email.notificationPreferences).toEqual({
      before: 'You can change your notification preferences in your ',
      link: 'account settings.',
      after: '',
    });
  });
});

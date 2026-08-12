import { describe, expect, it } from 'vitest';
import { isContactDecline, needsContactQuestion } from './contact-intake';

describe('needsContactQuestion', () => {
  const SERVICE_BRIEF = {
    intent: 'a summer pool cleaning special',
    audience: 'local homeowners',
    tone: 'friendly',
  };

  it('asks for a business/promotional brief with no contact info', () => {
    expect(needsContactQuestion(SERVICE_BRIEF)).toBe(true);
    expect(
      needsContactQuestion({ intent: 'Labor Day Sale social media post' })
    ).toBe(true);
    expect(needsContactQuestion({ intent: '20% off all services' })).toBe(true);
  });

  it('does not ask for a non-business ask', () => {
    expect(
      needsContactQuestion({ intent: 'a funny meme about remote work' })
    ).toBe(false);
    expect(
      needsContactQuestion({ intent: 'a birthday card for grandma' })
    ).toBe(false);
  });

  it('skips when the intent already carries a URL', () => {
    expect(
      needsContactQuestion({
        intent: 'a pool cleaning special — book at bluepool.com',
      })
    ).toBe(false);
    expect(
      needsContactQuestion({
        intent: 'summer sale',
        fixedCopy: 'https://www.example.shop/deals',
      })
    ).toBe(false);
  });

  it('skips when the corpus already carries a phone number', () => {
    expect(
      needsContactQuestion({
        intent: 'pool cleaning special, call (555) 123-4567',
      })
    ).toBe(false);
    expect(
      needsContactQuestion({ intent: 'summer sale', fixedCopy: '555-123-4567' })
    ).toBe(false);
    expect(
      needsContactQuestion({
        intent: 'van supply sale, call 1-800-VAN-SUPPLY',
      })
    ).toBe(false);
  });

  it('never asks twice (questionsAsked) and never after the recap', () => {
    expect(
      needsContactQuestion({ ...SERVICE_BRIEF, questionsAsked: ['contact'] })
    ).toBe(false);
    expect(
      needsContactQuestion({ ...SERVICE_BRIEF, recapShown: true })
    ).toBe(false);
  });

  it('is not stateful across calls (the shared lint patterns carry /g)', () => {
    const brief = { intent: 'summer sale, call 555-123-4567' };
    expect(needsContactQuestion(brief)).toBe(false);
    expect(needsContactQuestion(brief)).toBe(false);
  });
});

describe('isContactDecline', () => {
  it('matches the negative answers, case-insensitive, with punctuation', () => {
    for (const text of ['none', 'No', 'skip', 'Nope', 'n/a', 'N/A', 'none.', ' no thanks ']) {
      expect(isContactDecline(text)).toBe(true);
    }
  });

  it('does not match an actual answer', () => {
    for (const text of ['555-123-4567', 'bluepool.com', 'no wait — 555-123-4567']) {
      expect(isContactDecline(text)).toBe(false);
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiDesignerConversationalistService } from './ai-designer-conversationalist.service';
import { AiDesignerSkillRouter } from '../../skills/ai-designer-skill-router.service';
import type { DesignBrief } from '../../ai-designer.types';

const makeInput = (
  brief: DesignBrief,
  state = 'intake',
  text = 'hello',
  questionsAsked: string[] = [],
  lastQuestion?: string
) =>
  JSON.stringify({
    type: 'chat',
    text,
    ...(lastQuestion ? { lastQuestion } : {}),
    session: {
      mode: 'chat',
      state,
      brief,
      questionsAsked,
    },
  });

const CONFIDENT_BRIEF: DesignBrief = {
  intent: 'a funny meme about remote work',
  audience: 'followers',
  tone: 'funny',
};

describe('AiDesignerConversationalistService intake', () => {
  let ai: { generateText: ReturnType<typeof vi.fn> };
  let service: AiDesignerConversationalistService;

  beforeEach(() => {
    ai = {
      generateText: vi.fn().mockResolvedValue('{"intent":"general","text":"ok"}'),
    };
    service = new AiDesignerConversationalistService(
      ai as any,
      new AiDesignerSkillRouter()
    );
  });

  const handle = (raw_input: string) =>
    (service as any)._handler({ raw_input, metadata: {} }).then((res: any) =>
      JSON.parse(res.content)
    );

  it('asks ONE follow-up question for the first missing field instead of a form', async () => {
    // questionsAsked marks this as a later turn — the first-turn backstop
    // (tested below) would otherwise adopt the raw text as the intent.
    const res = await handle(makeInput({ intent: '' }, 'intake', 'hello', ['intent']));

    expect(res.type).toBe('chat-turn');
    expect(res.reply).toBe('What is this design about?');
  });

  it('asks for the next missing field in intent → audience → tone order', async () => {
    const res = await handle(makeInput({ intent: 'a meme about cats' }));

    expect(res.type).toBe('chat-turn');
    expect(res.reply).toBe('Who is the audience?');
  });

  it('returns the fields extracted from the free text alongside the reply', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'clarify',
        text: 'Love it — who is it for?',
        extracted: { intent: 'a meme about cats' },
      })
    );

    const res = await handle(makeInput({ intent: '' }, 'intake', 'a meme about cats'));

    expect(res.type).toBe('chat-turn');
    expect(res.fields).toEqual({ intent: 'a meme about cats' });
    // The classifier's text was computed against the PRE-merge brief, so the
    // deterministic post-merge question for the next missing field wins.
    expect(res.reply).toBe('Who is the audience?');
  });

  it('keeps the classifier phrasing when the turn extracted nothing', async () => {
    // A later turn (questionsAsked non-empty) — on the FIRST turn the
    // backstop would adopt the raw text as the intent instead.
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'clarify',
        text: 'Tell me more — what is it about?',
      })
    );

    const res = await handle(
      makeInput({ intent: '' }, 'intake', 'not sure yet', ['intent'])
    );

    expect(res.type).toBe('chat-turn');
    expect(res.fields).toBeUndefined();
    expect(res.reply).toBe('Tell me more — what is it about?');
  });

  it('never re-asks a field the merged brief already has', async () => {
    // The live bug: "followers" answers the audience question, the classifier
    // still says "What audience are you targeting?" — the reply must move on
    // to the post-merge next field (tone).
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'clarify',
        text: 'What audience are you targeting?',
        extracted: { audience: 'followers' },
      })
    );

    const res = await handle(
      makeInput({ intent: 'an end of summer sale' }, 'intake', 'followers', [
        'audience',
      ])
    );

    expect(res.type).toBe('chat-turn');
    expect(res.fields).toEqual({ audience: 'followers' });
    expect(res.reply).toBe(
      'What tone should it have — for example funny, professional, or inspiring?'
    );
  });

  it('tells the classifier which question the user is answering', async () => {
    await handle(
      makeInput(
        { intent: 'an end of summer sale' },
        'intake',
        'followers',
        ['audience'],
        'Who is the audience for your end of summer sale?'
      )
    );

    const prompt = ai.generateText.mock.calls[0][1] as string;
    expect(prompt).toContain(
      'The user is answering this question: "Who is the audience for your end of summer sale?"'
    );
    const system = ai.generateText.mock.calls[0][2].system as string;
    expect(system).toContain(
      'interpret the message as an answer to THAT question'
    );
  });

  it('omits the pending-question line when there is none', async () => {
    await handle(makeInput({ intent: '' }));

    const prompt = ai.generateText.mock.calls[0][1] as string;
    expect(prompt).not.toContain('The user is answering this question');
  });

  it('sanitizes the classifier extraction to non-empty strings', async () => {
    // The brief already carries an intent so the first-turn backstop (which
    // would adopt the raw text as the intent) stays out of the way.
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'clarify',
        text: 'Who is it for?',
        extracted: { intent: 42, tone: '  funny  ', audience: '' },
      })
    );

    const res = await handle(
      makeInput({ intent: 'a meme about cats' }, 'intake', 'make it funny')
    );

    expect(res.type).toBe('chat-turn');
    expect(res.fields).toEqual({ tone: 'funny' });
  });

  it('falls back to the quick form when the same question has stalled twice', async () => {
    const res = await handle(
      makeInput({ intent: 'x', audience: 'y' }, 'intake', 'dunno', ['tone', 'tone'])
    );

    expect(res.type).toBe('form');
    const names = res.fields.map((f: any) => f.name);
    expect(names).toEqual(['tone']);
  });

  it('returns the quick form when the user explicitly asks for one', async () => {
    // First turn + no extraction → the backstop adopts the raw text as the
    // intent, so the form only collects the still-missing fields and the
    // backstopped intent rides along as extraction.
    const res = await handle(
      makeInput({ intent: '' }, 'intake', 'can I just fill in a form?')
    );

    expect(res.type).toBe('form');
    const names = res.fields.map((f: any) => f.name);
    expect(names).toEqual(['audience', 'tone']);
    expect(res.extracted).toEqual({ intent: 'can I just fill in a form?' });
  });

  it('recaps the brief and asks for confirmation once every field is present', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'general',
        text: 'A funny remote-work meme for your followers. Ready for concepts?',
      })
    );

    const res = await handle(makeInput(CONFIDENT_BRIEF));

    expect(res.type).toBe('chat-turn');
    // The recap marker lets the conductor persist the server-owned
    // `recapShown` gate — only a post-recap accept may advance to planning.
    expect(res.recap).toBe(true);
    expect(res.reply).toContain('Ready for concepts?');
  });

  it('recap reply is always the deterministic summary, never the classifier text', async () => {
    // Live bug: the classifier returned a stray QUESTION as its text on the
    // recap turn ("What's the desired tone…?"); the turn still carried
    // recap: true, so recapShown was persisted without the user ever seeing a
    // recap — and the next one-word answer confirmed straight into planning.
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'clarify',
        text: "What's the desired tone for the Oktoberfest post?",
      })
    );

    const res = await handle(makeInput(CONFIDENT_BRIEF));

    expect(res.type).toBe('chat-turn');
    expect(res.recap).toBe(true);
    expect(res.reply).toContain("Here's what I have");
    expect(res.reply).toContain('Ready for concepts?');
    expect(res.reply).not.toContain('desired tone');
  });

  it('tells the classifier to keep concrete specifics verbatim and extract atomic fixedCopy units', async () => {
    await handle(
      makeInput({ intent: '' }, 'intake', 'social media post for our Labor Day Sale, coupon code LABOR26')
    );

    const system = ai.generateText.mock.calls[0][2].system as string;
    expect(system).toContain('never compress it to a generic category');
    // fixedCopy is atomic units joined with " | " — never a compound
    // sentence gluing offer + CTA + code (the live BEAN30 blob bug).
    expect(system).toContain('ATOMIC verbatim units');
    expect(system).toContain('join several units with " | "');
    expect(system).toContain('NEVER a compound sentence');
    // The mapping examples pin the exact behavior the live sessions got wrong.
    expect(system).toContain('Labor Day Sale social media post');
    expect(system).toContain('LABOR26');
    expect(system).toContain('"Join now | 30% off | BEAN30"');
  });

  it('recap fallback surfaces fixedCopy and other collected details', async () => {
    // The classifier produced no summary text, so the deterministic recap is
    // used — it must not drop the coupon code.
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'general', text: '' })
    );

    const res = await handle(
      makeInput({
        intent: 'Labor Day Sale social media post',
        audience: 'social media followers',
        tone: 'patriotic',
        fixedCopy: 'LABOR26',
      })
    );

    expect(res.type).toBe('chat-turn');
    expect(res.reply).toContain('LABOR26');
    expect(res.reply).toContain('Labor Day Sale social media post');
    expect(res.reply).toContain('Ready for concepts?');
  });

  it('recap fallback narrates extra collected fields but not server keys', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'general', text: '' })
    );

    const res = await handle(
      makeInput({
        intent: 'an end of summer sale',
        audience: 'followers',
        tone: 'urgent',
        deadline: 'Friday',
        questionsAsked: ['intent'],
        preferredSkill: 'advertisement',
        lastPlans: [{ variantId: 'v1', skill: 'meme' }],
        skillId: 'advertisement',
      })
    );

    expect(res.type).toBe('chat-turn');
    expect(res.reply).toContain('with deadline "Friday"');
    expect(res.reply).not.toContain('advertisement');
    expect(res.reply).not.toContain('questionsAsked');
    expect(res.reply).not.toContain('lastPlans');
  });

  it('confirms when the user accepts the summary — but only after a recap was shown', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'accept', text: 'Great!' })
    );

    const res = await handle(
      makeInput({ ...CONFIDENT_BRIEF, recapShown: true }, 'intake', 'yes, go ahead')
    );

    expect(res).toEqual({ type: 'chat-turn', confirmed: true });
  });

  it('accepts a whole-message accept phrase deterministically when the classifier is dead', async () => {
    // Dead org LLM: classification throws, the fallback intent is 'general' —
    // without the deterministic path the recap re-emits forever.
    ai.generateText.mockRejectedValue(new Error('provider down'));

    for (const text of ['yes', 'Looks good!']) {
      const res = await handle(
        makeInput({ ...CONFIDENT_BRIEF, recapShown: true }, 'intake', text)
      );
      expect(res.type).toBe('chat-turn');
      expect(res.confirmed).toBe(true);
      // The failure still rides the response so the conductor can count it.
      expect(res.classifierFailed).toBe(true);
    }
  });

  it('does not deterministically accept before the recap or with missing fields', async () => {
    ai.generateText.mockRejectedValue(new Error('provider down'));

    // Complete brief, no recap shown yet → the recap turn, not confirmed.
    let res = await handle(makeInput(CONFIDENT_BRIEF, 'intake', 'yes'));
    expect(res.confirmed).toBeUndefined();
    expect(res.recap).toBe(true);

    // Missing fields → the accept phrase is not a green light. ("yes" is a
    // non-substantive answer, so it never fills the asked field either.)
    res = await handle(
      makeInput(
        { intent: 'a meme', recapShown: true } as DesignBrief,
        'intake',
        'yes',
        ['audience']
      )
    );
    expect(res.confirmed).toBeUndefined();
  });

  it('does not deterministically accept a message that carries an instruction', async () => {
    ai.generateText.mockRejectedValue(new Error('provider down'));

    const res = await handle(
      makeInput(
        { ...CONFIDENT_BRIEF, recapShown: true },
        'intake',
        'looks good but make it darker'
      )
    );
    expect(res.confirmed).toBeUndefined();
  });

  it('flags classifierFailed only when classification actually failed', async () => {
    ai.generateText.mockResolvedValue('{"intent":"general","text":"ok"}');
    const ok = await handle(makeInput({ intent: 'a meme' }));
    expect(ok.classifierFailed).toBeUndefined();

    ai.generateText.mockRejectedValue(new Error('provider down'));
    const failed = await handle(makeInput({ intent: 'a meme' }));
    expect(failed.classifierFailed).toBe(true);
  });

  it('returns the recap (not confirmed) when accept arrives before any recap', async () => {
    // The live bug: one-word answers ("patriotic", "funny") classified as
    // accept on the first turn skipped the checkpoint entirely. Without the
    // server-owned recapShown flag the accept becomes the recap instead —
    // and the classifier's confirmation phrasing ("Great!") is not a recap,
    // so the deterministic summary stands in for it.
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'accept', text: 'Great!' })
    );

    const res = await handle(makeInput(CONFIDENT_BRIEF, 'intake', 'yes'));

    expect(res.type).toBe('chat-turn');
    expect(res.confirmed).toBeUndefined();
    expect(res.recap).toBe(true);
    expect(res.reply).toContain('Ready for concepts?');
  });

  it('backstops the intent from the raw text when the first turn extracted nothing', async () => {
    // The classifier returned no extraction (or failed outright) and the
    // brief has no intent yet — the raw first-turn text IS the intent, so
    // the conversation moves on to the audience question instead of
    // re-asking "What is this design about?".
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'general', text: 'ok' })
    );

    const res = await handle(
      makeInput({ intent: '' }, 'intake', '  a meme about cats  ')
    );

    expect(res.type).toBe('chat-turn');
    expect(res.fields).toEqual({ intent: 'a meme about cats' });
    expect(res.reply).toBe('Who is the audience?');
  });

  it('bounds the backstopped intent to 2000 chars', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'general', text: 'ok' })
    );

    const res = await handle(
      makeInput({ intent: '' }, 'intake', ` a meme about cats ${'x'.repeat(2100)} `)
    );

    expect(res.fields.intent).toHaveLength(2000);
    expect(res.fields.intent.startsWith('a meme about cats')).toBe(true);
  });

  it('backstops the intent when a PARTIAL first-turn extraction lacks it', async () => {
    // The classifier extracted a tone but missed the intent — the raw text
    // still IS the intent, so the conversation moves to the audience question
    // instead of re-asking what the design is about.
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'clarify',
        text: 'Who is it for?',
        extracted: { tone: 'funny' },
      })
    );

    const res = await handle(
      makeInput({ intent: '' }, 'intake', 'a meme about cats')
    );

    expect(res.type).toBe('chat-turn');
    expect(res.fields).toEqual({ tone: 'funny', intent: 'a meme about cats' });
    expect(res.reply).toBe('Who is the audience?');
  });

  it('keeps a Spanish first turn verbatim as the intent (offer and code survive)', async () => {
    // The S6 case: the classifier returned no usable extraction for a Spanish
    // brief — the raw text carries the offer and code into the brief verbatim.
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'general', text: 'ok' })
    );
    const text =
      'publicación para el 10% de descuento en mochilas con el código MOCHILA10';

    const res = await handle(makeInput({ intent: '' }, 'intake', text));

    expect(res.fields.intent).toBe(text);
  });

  it('fills the asked field from the raw answer when extraction misses it (any language)', async () => {
    // The S4 case: the user answered "Who is the audience?" in Spanish and
    // the classifier extracted nothing — the answer must not be re-asked.
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'clarify', text: '¿Para quién es?' })
    );

    const res = await handle(
      makeInput(
        { intent: 'rebajas de fin de verano' },
        'intake',
        'nuestros seguidores de Instagram',
        ['intent', 'audience']
      )
    );

    expect(res.type).toBe('chat-turn');
    expect(res.fields).toEqual({ audience: 'nuestros seguidores de Instagram' });
    expect(res.reply).toBe(
      'What tone should it have — for example funny, professional, or inspiring?'
    );
  });

  it('does not adopt a greeting or a "no idea" hedge as the asked field', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'clarify',
        text: 'No worries — what tone feels right?',
      })
    );

    const res = await handle(
      makeInput(
        { intent: 'a meme about cats', audience: 'followers' },
        'intake',
        'not sure',
        ['tone']
      )
    );

    expect(res.type).toBe('chat-turn');
    expect(res.fields).toBeUndefined();
    expect(res.reply).toBe('No worries — what tone feels right?');
  });

  const TONE_QUESTION =
    'What tone should it have — for example funny, professional, or inspiring?';

  it('REPLACES an already-set tone when the user answers the tone question', async () => {
    // Live: the user answered the style question with "minimal Scandinavian,
    // warm" and the stored brief kept tone "energetic". The classifier stayed
    // silent on that turn, and the old backstop was fill-only AND keyed off
    // questionsAsked, which stops growing once nothing is missing.
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'general', text: 'ok' })
    );

    const res = await handle(
      makeInput(
        { intent: 'a coffee subscription launch', audience: 'foodies', tone: 'energetic' },
        'intake',
        'minimal Scandinavian, warm',
        [],
        TONE_QUESTION
      )
    );

    expect(res.fields).toEqual({ tone: 'minimal Scandinavian, warm' });
  });

  it('keeps the classifier tone over the raw text on a correction turn', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'clarify',
        text: 'Got it.',
        extracted: { tone: 'minimal Scandinavian and warm' },
      })
    );

    const res = await handle(
      makeInput(
        { intent: 'a coffee subscription launch', audience: 'foodies', tone: 'energetic' },
        'intake',
        'make it minimal Scandinavian, warm',
        [],
        TONE_QUESTION
      )
    );

    expect(res.fields).toEqual({ tone: 'minimal Scandinavian and warm' });
  });

  it('does not adopt a hedge as a tone correction', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'general', text: 'ok' })
    );

    const res = await handle(
      makeInput(
        { intent: 'a coffee subscription launch', audience: 'foodies', tone: 'energetic' },
        'intake',
        'not sure',
        [],
        TONE_QUESTION
      )
    );

    expect(res.fields).toBeUndefined();
  });

  it('leaves a filled audience alone — the correction path is tone-only', async () => {
    // The fill-only backstop for intent/audience is unchanged: only tone may
    // be REPLACED, because only tone has the style/aesthetic restatement case.
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'general', text: 'ok' })
    );

    const res = await handle(
      makeInput(
        CONFIDENT_BRIEF,
        'intake',
        'actually, small business owners',
        ['audience'],
        'Who is the audience?'
      )
    );

    expect(res.fields).toBeUndefined();
  });

  it('never fills preferredSkill from raw text (form-controlled)', async () => {
    const res = await handle(
      makeInput(CONFIDENT_BRIEF, 'intake', 'meme', ['preferredSkill'])
    );

    expect(res.type).toBe('chat-turn');
    expect(res.recap).toBe(true);
    expect(res.fields).toBeUndefined();
  });

  it('uses "an" before a vowel-led tone in the recap', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'general', text: '' })
    );

    const res = await handle(
      makeInput({ ...CONFIDENT_BRIEF, tone: 'excited' })
    );

    expect(res.reply).toContain('with an excited tone');
  });

  it('tells the classifier to extract tone from casual phrasing and keep schedule specifics verbatim', async () => {
    await handle(
      makeInput({ intent: '' }, 'intake', 'a patriotic themed post for the first Friday of every month')
    );

    const system = ai.generateText.mock.calls[0][2].system as string;
    expect(system).toContain('"patriotic themed" → tone: "patriotic"');
    expect(system).toContain('"make it funny" → tone: "funny"');
    expect(system).toContain('first Friday of every month');
  });

  it('merges the routed skill\'s requiredBriefFields into the intake check', () => {
    const missing = (service as any)._missingRequiredFields(
      { intent: 'x', audience: 'y', tone: 'z' },
      ['intent', 'fixedCopy']
    );
    expect(missing).toEqual(['fixedCopy']);

    const fields = (service as any)._defaultFieldsFor(missing, []);
    expect(fields).toEqual([
      expect.objectContaining({ name: 'fixedCopy', type: 'text' }),
    ]);
  });

  it('never drops the base fields when a skill adds its own', () => {
    const missing = (service as any)._missingRequiredFields(
      { intent: 'a meme about cats' },
      ['intent', 'tone']
    );
    expect(missing).toEqual(['audience', 'tone']);
  });

  it('emits a skill-choice form when routing is low-confidence', async () => {
    const brief: DesignBrief = {
      intent: 'something nice for our page',
      audience: 'followers',
      tone: 'playful',
    };
    const res = await handle(makeInput(brief));

    expect(res.type).toBe('form');
    expect(res.fields).toHaveLength(1);
    const field = res.fields[0];
    expect(field.name).toBe('preferredSkill');
    expect(field.type).toBe('radio');
    // Top guess first, then the router's alternatives — all with titles.
    expect(field.options.length).toBeGreaterThan(1);
    expect(field.options[0].value).toBe('product-promo');
    for (const option of field.options) {
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('does not re-ask once the user picked a skill (preferredSkill override)', async () => {
    const brief: DesignBrief = {
      intent: 'something nice for our page',
      audience: 'followers',
      tone: 'playful',
      preferredSkill: 'greeting-card',
    };
    const res = await handle(makeInput(brief));

    expect(res.type).toBe('chat-turn');
    expect(res.reply).toBeTruthy();
  });

  it('does not emit the choice form when routing is confident', async () => {
    const res = await handle(makeInput(CONFIDENT_BRIEF));

    expect(res.type).toBe('chat-turn');
    expect(res.fields).toBeUndefined();
  });

  it('carries the turn\'s extraction on the skill-choice form (no re-ask after submit)', async () => {
    // Regression: answering the audience question completed the brief, but
    // the low-confidence skill form came back in the same turn — if the
    // extraction doesn't ride along, the conductor drops it and re-asks
    // "Who is the audience?" after the form is submitted.
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'clarify',
        text: 'Who is the audience?',
        extracted: { audience: 'followers' },
      })
    );

    const res = await handle(
      makeInput(
        { intent: 'something nice for our page', tone: 'playful' },
        'intake',
        'followers',
        ['intent', 'audience'],
        'Who is the audience?'
      )
    );

    expect(res.type).toBe('form');
    expect(res.fields[0].name).toBe('preferredSkill');
    expect(res.extracted).toEqual({ audience: 'followers' });
  });

  // ── The accept short-circuit forwards its extraction (round 8 B2) ──

  it('forwards the extraction on the confirming turn', async () => {
    // The accept branch was the ONE intake return shape that omitted
    // fields/extracted, so a "yes" that ALSO carried substance lost it.
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'accept',
        text: 'On it',
        extracted: { fixedCopy: 'Open from 8am' },
      })
    );

    const res = await handle(
      makeInput(
        { ...CONFIDENT_BRIEF, recapShown: true },
        'intake',
        'yes, and it must say Open from 8am',
        ['intent', 'audience', 'tone']
      )
    );

    expect(res.confirmed).toBe(true);
    expect(res.fields).toEqual({ fixedCopy: 'Open from 8am' });
  });

  it('still confirms with no fields when the accept carries nothing', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'accept', text: 'On it' })
    );

    const res = await handle(
      makeInput({ ...CONFIDENT_BRIEF, recapShown: true }, 'intake', 'yes', [
        'intent',
        'audience',
        'tone',
      ])
    );

    expect(res).toEqual({ type: 'chat-turn', confirmed: true });
  });

  // ── Recap rendering (round 8 C7c) ──

  it('renders multi-unit fixedCopy as a quoted list, not the raw separator', async () => {
    const summary = (service as any)._summaryFor({
      intent: 'a anniversary card',
      audience: 'customers',
      tone: 'warm',
      fixedCopy: 'with love, the whole crew | Since 2019',
    });

    expect(summary).toContain(
      'with the exact copy "with love, the whole crew" and "Since 2019"'
    );
    expect(summary).not.toContain(' | ');
  });

  it('renders a single fixedCopy unit as one quoted string', async () => {
    const summary = (service as any)._summaryFor({
      intent: 'a launch post',
      audience: 'followers',
      tone: 'bold',
      fixedCopy: 'BEAN30',
    });

    expect(summary).toContain('with the exact copy "BEAN30"');
  });
});

describe('AiDesignerConversationalistService delivered state', () => {
  let ai: { generateText: ReturnType<typeof vi.fn> };
  let service: AiDesignerConversationalistService;

  beforeEach(() => {
    ai = {
      generateText: vi.fn().mockResolvedValue('{"intent":"general","text":"ok"}'),
    };
    service = new AiDesignerConversationalistService(
      ai as any,
      new AiDesignerSkillRouter()
    );
  });

  const handle = (raw_input: string) =>
    (service as any)._handler({ raw_input, metadata: {} }).then((res: any) =>
      JSON.parse(res.content)
    );

  it('surfaces accept as a distinct type so the conductor can auto-save templates', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'accept', text: 'Great — enjoy!' })
    );

    const res = await handle(
      makeInput(CONFIDENT_BRIEF, 'delivered', 'looks good')
    );

    expect(res).toEqual({ type: 'accept', text: 'Great — enjoy!' });
  });

  it('normalizes a revision request with the default target', async () => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({
        intent: 'revise',
        text: 'Sure',
        revision: { instruction: 'make the headline bigger' },
      })
    );

    const res = await handle(
      makeInput(CONFIDENT_BRIEF, 'delivered', 'make the headline bigger')
    );

    expect(res.type).toBe('revision');
    expect(res.revision).toEqual(
      expect.objectContaining({
        instruction: 'make the headline bigger',
        scope: 'shared',
      })
    );
  });

  // ── Labelled design catalogue (round 8 C5) ──

  const CATALOGUE = [
    { ordinal: 1, designId: 'design-A', formatIds: ['ig-post'] },
    { ordinal: 2, designId: 'design-B', formatIds: ['fb-post'] },
    { ordinal: 3, designId: 'design-C', formatIds: ['ig-story'] },
  ];

  const makeDeliveredInput = (text: string, revision: unknown) => {
    ai.generateText.mockResolvedValue(
      JSON.stringify({ intent: 'revise', text: 'Sure', revision })
    );
    return JSON.stringify({
      type: 'chat',
      text,
      session: {
        mode: 'chat',
        state: 'delivered',
        brief: CONFIDENT_BRIEF,
        questionsAsked: [],
        activeDesignIds: ['design-A', 'design-B', 'design-C'],
        designs: CATALOGUE,
      },
    });
  };

  it('prefers the ordinal the user actually said over the classifier pick', async () => {
    // Live: asked for "the Facebook version" the classifier answered with a
    // different variant's id, and set membership could not tell.
    const res = await handle(
      makeDeliveredInput('make the headline bigger on variant 3', {
        instruction: 'make the headline bigger',
        targetDesignId: 'design-A',
      })
    );

    expect(res.revision.targetDesignId).toBe('design-C');
  });

  it('resolves a spoken ordinal ("the second one")', async () => {
    const res = await handle(
      makeDeliveredInput('tweak the second one', {
        instruction: 'tweak it',
      })
    );

    expect(res.revision.targetDesignId).toBe('design-B');
  });

  it('resolves a bare hash ordinal ("use #3")', async () => {
    // The `#` alternative used to sit behind `\b`, which can never precede a
    // non-word character — a bare "#3" never matched.
    const res = await handle(
      makeDeliveredInput('use #3 but darker', {
        instruction: 'make it darker',
      })
    );

    expect(res.revision.targetDesignId).toBe('design-C');
  });

  it('drops a targetDesignId that is not in the catalogue at all', async () => {
    const res = await handle(
      makeDeliveredInput('make the headline bigger', {
        instruction: 'make the headline bigger',
        targetDesignId: 'design-does-not-exist',
      })
    );

    expect(res.revision.targetDesignId).toBe('design-A');
  });

  it('keeps a catalogue id the user did not contradict', async () => {
    const res = await handle(
      makeDeliveredInput('make the headline bigger', {
        instruction: 'make the headline bigger',
        targetDesignId: 'design-B',
      })
    );

    expect(res.revision.targetDesignId).toBe('design-B');
  });
});

import { describe, it, expect } from 'vitest';
import { PROMPT_CONSTANTS } from './prompt-constants.const';

describe('PROMPT_CONSTANTS parameterized prompts', () => {
  it('separatePosts embeds the length bounds', () => {
    const out = PROMPT_CONSTANTS.separatePosts(280);
    expect(out).toContain('270');
    expect(out).toContain('280');
  });

  it('separatePostShrink embeds the max length', () => {
    expect(PROMPT_CONSTANTS.separatePostShrink(500)).toContain('500');
  });

  it('generateHashtags embeds the platform', () => {
    expect(PROMPT_CONSTANTS.generateHashtags('LinkedIn')).toContain('LinkedIn');
  });

  it('generateAltTextFallbackPrompt embeds the image reference', () => {
    expect(PROMPT_CONSTANTS.generateAltTextFallbackPrompt('img-1')).toContain('img-1');
  });

  it('agentStartCall embeds today', () => {
    expect(PROMPT_CONSTANTS.agentStartCall('2026-07-02')).toContain('2026-07-02');
  });

  it('agentGenerateHook embeds tone and person mode', () => {
    const out = PROMPT_CONSTANTS.agentGenerateHook('casual', 'first');
    expect(out).toContain('casual');
    expect(out).toContain('first');
  });

  it('agentGenerateContent embeds its inputs', () => {
    const out = PROMPT_CONSTANTS.agentGenerateContent('casual', 'first', 'short', 'one');
    expect(out).toContain('casual');
    expect(out).toContain('short');
  });

  it('checkCompliance embeds the content and platform', () => {
    expect(PROMPT_CONSTANTS.checkCompliance('hello', 'x')).toContain('hello');
  });
});

import { describe, it, expect } from 'vitest';
import { DISCORD_MENTION_MARKER_REGEX } from '../social.adapter';

const formatMentions = (message: string) =>
  message.replace(DISCORD_MENTION_MARKER_REGEX, (match, p1) => `<${p1}>`);

describe('Discord mention marker regex', () => {
  it('replaces multiple markers without crossing a ]', () => {
    expect(formatMentions('[[[@alice]]] and [[[@bob]]]')).toBe('<@alice> and <@bob>');
  });

  it('does not cross a ] inside the marker', () => {
    expect(formatMentions('[[[@alice]suffix]]]')).toBe('[[[@alice]suffix]]]');
  });
});

/**
 * Language display-name helpers shared by the UI-language picker
 * (`layout/language.component.tsx`) and the studio dynamic form's `language`
 * enum fields (e.g. Whisper STT), which used to show raw BCP-47 codes.
 */

/** A BCP-47-ish code: `en`, `eng`, `en-US`, `zh-Hant`, … */
export const isLikelyLanguageCode = (value: string): boolean =>
  /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(value);

/**
 * Language name in its OWN script (native endonym), via Intl.DisplayNames —
 * the right choice for a language picker, where each row must be readable to
 * the speaker of that language. Falls back to the raw code when the API or
 * the code is unsupported.
 */
export const getLanguageName = (code: string): string => {
  try {
    const displayNames = new Intl.DisplayNames([code], {
      type: 'language',
    });
    return displayNames.of(code) || code;
  } catch {
    // API unsupported or unknown code — the raw code is the honest label.
    return code;
  }
};

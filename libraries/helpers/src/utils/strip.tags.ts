/**
 * Strip all HTML tags to plain text. Loops until the string stabilises so
 * partial/nested tags (`<scr<script>ipt>`) cannot survive a single pass —
 * this is the shape CodeQL's incomplete-multi-character-sanitization query
 * requires. Output is plain text for display/length checks, never HTML.
 */
export function stripHtmlTags(input?: string | null): string {
  let s = input ?? '';
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s;
}

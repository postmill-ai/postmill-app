import DOMPurify from 'isomorphic-dompurify';

// Server-side sanitize for campaign-note rich HTML. The allowlist MUST stay in
// lockstep with the frontend `SafeContent` component
// (apps/frontend/src/components/shared/safe-content.tsx) so stored HTML is safe
// regardless of the render path (defense-in-depth: we sanitize on write AND render).
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 's', 'del', 'u', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'span', 'mark', 'img', 'video', 'source', 'div',
  'sub', 'sup', 'code', 'pre', 'blockquote',
];

const ALLOWED_ATTR = [
  'href', 'target', 'rel', 'class', 'data-mention-id', 'data-mention-label',
  'src', 'alt', 'width', 'height', 'controls', 'type',
  'data-tooltip-id', 'data-tooltip-content', 'style',
];

// Note: DOMPurify strips `target` from anchors by default (even though `target`
// is in ALLOWED_ATTR, to mirror SafeContent), so stored note links can never open
// a new tab — there is no reverse-tabnabbing vector to guard against here.
export const sanitizeNoteHtml = (html: string): string =>
  DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/|#)/i,
  });

'use client';

import { FC, HTMLAttributes } from 'react';
import DOMPurify from 'isomorphic-dompurify';

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

export const SafeContent: FC<{
  content: string;
  className?: string;
  as?: 'div' | 'span';
} & HTMLAttributes<HTMLElement>> = ({ content, className, as: Tag = 'div', ...rest }) => {
  const sanitized = DOMPurify.sanitize(content, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/|#)/i,
  });

  return <Tag {...rest} className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />;
};

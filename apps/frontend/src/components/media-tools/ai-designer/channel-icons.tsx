'use client';

import React from 'react';

// Monochrome (currentColor) brand glyphs for the CHANNEL_PRESETS provider ids.
// The shared ProviderIcon (components/shared/provider-icon) covers AI/media/
// storage providers only — no social channel identifiers — so the AI Designer
// start page keeps this small local set. Unknown/null providers get the
// generic "custom size" frame glyph.

const GLYPHS: Record<string, React.ReactNode> = {
  instagram: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </g>
  ),
  facebook: (
    <path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.7c0-.9.3-1.6 1.6-1.6h1.6V4.2c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.7H7.8V14h2.7v8h3z" />
  ),
  x: (
    <path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L2 3h6.5l4.4 5.8L17.8 3zm-1.1 16.1h1.7L7.6 4.7H5.8l10.9 14.4z" />
  ),
  linkedin: (
    <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S.02 4.88.02 3.5 1.13 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8h4V23h-4V8zm7.5 0h3.8v2.05h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V23h-4v-7.9c0-1.88-.03-4.3-2.62-4.3-2.62 0-3.02 2.05-3.02 4.17V23h-4V8z" />
  ),
  tiktok: (
    <path d="M16.6 3c.4 2.2 1.9 3.7 4.1 3.9v3.1c-1.6 0-3-.5-4.1-1.3v6.6c0 3.4-2.4 5.7-5.6 5.7-3.1 0-5.5-2.3-5.5-5.4 0-3.2 2.6-5.6 6-5.4v3.2c-1.6-.3-2.9.8-2.9 2.2 0 1.3 1 2.3 2.4 2.3 1.5 0 2.6-1.1 2.6-2.8V3h3z" />
  ),
  youtube: (
    <path d="M21.6 7.2c-.2-1.5-1-2.6-2.4-2.8C17.2 4 12 4 12 4s-5.2 0-7.2.4C3.4 4.6 2.6 5.7 2.4 7.2 2 9.1 2 12 2 12s0 2.9.4 4.8c.2 1.5 1 2.6 2.4 2.8 2 .4 7.2.4 7.2.4s5.2 0 7.2-.4c1.4-.2 2.2-1.3 2.4-2.8.4-1.9.4-4.8.4-4.8s0-2.9-.4-4.8zM10 15.2V8.8L15.5 12 10 15.2z" />
  ),
  pinterest: (
    <path d="M12 2C6.5 2 2 6.5 2 12c0 4.2 2.6 7.8 6.3 9.3-.1-.8-.2-2 0-2.9l1.2-5.1s-.3-.6-.3-1.5c0-1.4.8-2.5 1.9-2.5.9 0 1.3.7 1.3 1.5 0 .9-.6 2.2-.9 3.5-.2 1 .5 1.9 1.6 1.9 1.9 0 3.3-2 3.3-4.8 0-2.5-1.8-4.3-4.4-4.3-3 0-4.8 2.3-4.8 4.6 0 .9.3 1.9.8 2.5.1.1.1.2.1.3l-.3 1.1c0 .2-.2.2-.4.1-1.2-.6-2-2.4-2-3.9 0-3.2 2.3-6.1 6.7-6.1 3.5 0 6.2 2.5 6.2 5.8 0 3.5-2.2 6.3-5.3 6.3-1 0-2-.5-2.3-1.2l-.6 2.4c-.2.9-.8 1.9-1.2 2.6.9.3 1.9.4 2.9.4 5.5 0 10-4.5 10-10S17.5 2 12 2z" />
  ),
};

const CUSTOM_SIZE_GLYPH = (
  <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </g>
);

export const ChannelIcon: React.FC<{
  /** CHANNEL_PRESETS provider id (instagram/facebook/x/…); null → generic. */
  provider?: string | null;
  size?: number;
  className?: string;
}> = ({ provider, size = 16, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className ?? 'shrink-0 text-textColor/70'}
  >
    {(provider && GLYPHS[provider]) || CUSTOM_SIZE_GLYPH}
  </svg>
);

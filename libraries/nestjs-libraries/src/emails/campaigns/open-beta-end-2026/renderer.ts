import type {
  OpenBetaEndContent,
  RenderedOpenBetaEndEmail,
} from './types';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });

const formatText = (value: string) =>
  escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>');

const paragraph = (text: string, emphasis = false) =>
  `<p style="margin:0 0 18px;line-height:1.65;color:#374151;">${
    emphasis ? `<strong>${formatText(text)}</strong>` : formatText(text)
  }</p>`;

const heading = (text: string) =>
  `<h2 style="margin:28px 0 14px;font-size:22px;line-height:1.35;color:#1f2937;">${formatText(text)}</h2>`;

const bullets = (
  items: { title?: string; text: string }[],
  includeTitle = true
) =>
  `<ul style="margin:0 0 20px;padding-inline-start:24px;color:#374151;">${items
    .map(
      (item) =>
        `<li style="margin:0 0 12px;line-height:1.6;">${
          includeTitle && item.title
            ? `<strong>${escapeHtml(item.title)}:</strong> `
            : ''
        }${formatText(item.text)}</li>`
    )
    .join('')}</ul>`;

export const renderOpenBetaEndEmail = (
  content: OpenBetaEndContent
): RenderedOpenBetaEndEmail => {
  const html = [
    paragraph(content.greeting),
    ...content.introduction.map((item) => paragraph(item.text, item.emphasis)),
    heading(content.progressTitle),
    ...content.progress.map((item) => paragraph(item)),
    bullets(content.highlights),
    ...content.progressClosing.map((item) => paragraph(item)),
    heading(content.changesTitle),
    ...content.changes.map((item) => paragraph(item.text, item.emphasis)),
    bullets(content.trialFacts.map((text) => ({ text })), false),
    paragraph(content.trialNote),
    heading(content.finalTitle),
    ...content.finalParagraphs.map((item) => paragraph(item.text, item.emphasis)),
    paragraph(content.bestRegards),
    '<p style="margin:0;line-height:1.6;color:#1f2937;"><strong>Rick Somers</strong><br />' +
      `${escapeHtml(content.role)}<br />Postmill AI Inc.<br />` +
      '<a href="https://postmill.ai" style="color:#2b5cd3;text-decoration:none;">https://postmill.ai</a></p>',
  ].join('');

  const text = [
    content.greeting,
    ...content.introduction.map((item) => item.text),
    content.progressTitle,
    ...content.progress,
    ...content.highlights.map((item) => `- ${item.title}: ${item.text}`),
    ...content.progressClosing,
    content.changesTitle,
    ...content.changes.map((item) => item.text),
    ...content.trialFacts.map((item) => `- ${item}`),
    content.trialNote,
    content.finalTitle,
    ...content.finalParagraphs.map((item) => item.text),
    content.bestRegards,
    'Rick Somers',
    content.role,
    'Postmill AI Inc.',
    'https://postmill.ai',
  ].join('\n\n');

  return {
    subject: content.subject,
    html,
    text,
    locale: content.locale,
    direction: content.direction,
    notificationPreferences: content.notificationPreferences,
  };
};

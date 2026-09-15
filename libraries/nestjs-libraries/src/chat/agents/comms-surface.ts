import dayjs from 'dayjs';
import { getAccess } from '@postmill-ai/nestjs-libraries/chat/tools/tool.helpers';

/**
 * Every specialist prompt starts with this. Specialists resolve relative
 * dates ("tomorrow at 10:00") themselves when the supervisor delegates in
 * natural language, so they need the clock too — without it a model invents
 * a year.
 */
export const specialistPreamble = (): string =>
  `Global information:\n  - Date (UTC): ${dayjs().format('YYYY-MM-DD HH:mm:ss')}\n\n`;

export const CONFIRM_LINE = 'Reply YES to confirm or NO to cancel.';

export const isCommsSurface = (requestContext: any): boolean =>
  requestContext?.get?.('ui') !== 'true' && getAccess({ requestContext })?.mode === 'comms';

/**
 * Rules a specialist needs when the turn comes from a chat app. Specialists
 * hold the outward tools, so they — not just the supervisor — must know that
 * the confirmation step is enforced by the CommsConfirmationGate and that
 * asking the user first would make them confirm twice.
 */
export const specialistCommsRules = (requestContext: any): string =>
  isCommsSurface(requestContext)
    ? `
Chat-app surface (no UI cards):
- Do NOT ask the user for confirmation before calling an outward tool — call it right away with the complete details. The tool itself parks the action and returns { needsConfirmation: true, summary, instructions }.
- When a tool returns needsConfirmation: true, do not call it again; return its summary and instructions to the supervisor verbatim.
`
    : '';

import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';

type AccessMode = {
  mode: string;
  scopes?: string[];
};

function _get(context: any, key: string): string | undefined {
  return context?.requestContext?.get(key);
}

export function getAccess(context?: any): AccessMode | null {
  const raw = _get(context, 'access');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AccessMode;
  } catch {
    return null;
  }
}

export function parseOrg(context?: any): { id: string; [key: string]: any } {
  const raw = _get(context, 'organization');
  if (!raw) {
    throw new Error('Organization context missing');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Organization context is not valid JSON');
  }
  // Fail closed: without a concrete id, Prisma 6 omits `where: { organizationId:
  // undefined }` and every org-scoped query goes cross-tenant. Mirror parseUser.
  if (!parsed?.id) {
    throw new Error('Organization context missing id');
  }
  return parsed;
}

export function parseUser(context?: any): { id: string } {
  const raw = _get(context, 'user');
  if (!raw) {
    throw new Error('User context missing');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('User context is not valid JSON');
  }
  if (!parsed?.id) {
    throw new Error('User context missing id');
  }
  return parsed;
}

export function requireWrite(context?: any): void {
  const access = getAccess(context);
  if (!access) {
    throw new Error('Write access denied: no access context');
  }
  if (access.mode === 'user') {
    return;
  }
  if (access.mode === 'mcp') {
    if (!access.scopes?.includes('mcp:posts:write')) {
      throw new Error('Write access denied: mcp:posts:write scope required');
    }
    return;
  }
  if (access.mode === 'headless') {
    throw new Error('Write access denied: headless runs are read-only');
  }
  throw new Error(`Write access denied: unrecognized mode '${access.mode}'`);
}

export function requireRead(context?: any): void {
  const access = getAccess(context);
  if (!access) {
    throw new Error('Read access denied: no access context');
  }
  if (access.mode === 'user' || access.mode === 'headless') {
    return;
  }
  if (access.mode === 'mcp') {
    if (!access.scopes?.includes('mcp:read')) {
      throw new Error('Read access denied: mcp:read scope required');
    }
    return;
  }
  throw new Error(`Read access denied: unrecognized mode '${access.mode}'`);
}

export async function guardOutbound(
  guardrailService: GuardrailService,
  content: string,
  options: { userId?: string; orgId?: string }
): Promise<string> {
  return guardrailService.checkOutput(content, options);
}

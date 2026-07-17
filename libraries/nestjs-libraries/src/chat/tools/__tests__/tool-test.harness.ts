import type { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';

export type ToolContextInput = {
  inputData: Record<string, any>;
  organization?: Record<string, any> | string;
  user?: Record<string, any> | string;
  access?: Record<string, any> | string;
  ui?: boolean | string;
};

class RequestContext {
  private readonly store = new Map<string, string>();

  constructor(seed: {
    organization?: Record<string, any> | string;
    user?: Record<string, any> | string;
    access?: Record<string, any> | string;
    ui?: boolean | string;
  }) {
    if (seed.organization !== undefined) {
      this.store.set(
        'organization',
        typeof seed.organization === 'string'
          ? seed.organization
          : JSON.stringify(seed.organization)
      );
    }
    if (seed.user !== undefined) {
      this.store.set(
        'user',
        typeof seed.user === 'string' ? seed.user : JSON.stringify(seed.user)
      );
    }
    if (seed.access !== undefined) {
      this.store.set(
        'access',
        typeof seed.access === 'string' ? seed.access : JSON.stringify(seed.access)
      );
    }
    if (seed.ui !== undefined) {
      this.store.set(
        'ui',
        typeof seed.ui === 'string' ? seed.ui : String(seed.ui)
      );
    } else {
      this.store.set('ui', 'false');
    }
  }

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }
}

export async function executeTool(
  toolInstance: AgentToolInterface,
  { inputData, organization, user, access, ui }: ToolContextInput
): Promise<any> {
  const tool = await toolInstance.run();
  const requestContext = new RequestContext({
    organization,
    user,
    access,
    ui,
  });
  return tool.execute(inputData, { requestContext });
}

export function makeOrganization(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'org-test-1',
    name: 'Test Organization',
    ...overrides,
  };
}

export function makeUser(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'user-test-1',
    email: 'test@example.com',
    ...overrides,
  };
}

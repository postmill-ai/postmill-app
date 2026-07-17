import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStructuredOutput = {};

const mockLangchainModel = {
  withStructuredOutput: vi.fn().mockReturnValue(mockStructuredOutput),
};

vi.mock('@gitroom/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class {
    langchainModel = vi.fn().mockResolvedValue(mockLangchainModel);
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {
    createPopularPosts = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@langchain/core/messages', () => ({
  BaseMessage: class {},
  HumanMessage: class {
    content: string;
    constructor(content: string) {
      this.content = content;
    }
  },
}));

vi.mock('@langchain/core/prompts', () => ({
  ChatPromptTemplate: {
    fromTemplate: vi.fn().mockReturnValue({
      pipe: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({}),
      }),
    }),
  },
}));

// A StateGraph mock whose compiled app actually walks the registered nodes in
// edge order and invokes each — so an UNBOUND node (its `this` is undefined and
// `this._aiModelProvider` throws) makes the invocation reject. This is what locks
// the `.bind(this)` on every node against regression.
vi.mock('@langchain/langgraph', () => ({
  END: '__end__',
  START: '__start__',
  StateGraph: class {
    private nodes = new Map<string, (state: any) => Promise<any>>();
    private edges = new Map<string, string>();
    addNode(name: string, fn: (state: any) => Promise<any>) {
      this.nodes.set(name, fn);
      return this;
    }
    addEdge(from: string, to: string) {
      this.edges.set(from, to);
      return this;
    }
    compile() {
      return {
        invoke: async (initial: any) => {
          let state = { ...initial };
          let current = this.edges.get('__start__');
          while (current && current !== '__end__') {
            const fn = this.nodes.get(current);
            const partial = await fn(state);
            state = { ...state, ...partial };
            current = this.edges.get(current);
          }
          return state;
        },
      };
    }
  },
}));

import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AgentGraphInsertService } from './agent.graph.insert.service';

describe('AgentGraphInsertService', () => {
  let service: AgentGraphInsertService;
  let aiModelProvider: AIModelProvider;
  let postsService: PostsService;

  beforeEach(() => {
    vi.clearAllMocks();
    postsService = new (PostsService as any)();
    aiModelProvider = new (AIModelProvider as any)();
    service = new AgentGraphInsertService(postsService, aiModelProvider);
  });

  it('runs newPost to completion and resolves the AI provider (node bindings intact)', async () => {
    await expect(service.newPost('A social media post')).resolves.toBeDefined();

    // Three model nodes (category/topic/hook) each resolve the GLOBAL provider —
    // if any node were passed unbound, `this._aiModelProvider` would be undefined and reject.
    expect(aiModelProvider.langchainModel).toHaveBeenCalledTimes(3);
    expect(aiModelProvider.langchainModel).toHaveBeenCalledWith('utility');
    expect(postsService.createPopularPosts).toHaveBeenCalledTimes(1);
  });
});

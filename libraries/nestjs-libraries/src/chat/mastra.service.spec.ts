import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/load.tools.service', () => ({
  LoadToolsService: class {
    agent = vi.fn().mockResolvedValue({
      id: 'postmill',
      name: 'postmill',
    });
  },
}));

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: { _type: 'mock.mastra.store' },
}));

vi.mock('@mastra/core/mastra', () => ({
  Mastra: class {
    static instance: any;
    agents: Record<string, any>;

    constructor(config: any) {
      this.agents = config.agents ?? {};
    }

    getAgent(name: string) {
      return this.agents[name];
    }

    listAgents() {
      return this.agents;
    }
  },
}));

import { MastraService } from './mastra.service';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { Mastra } from '@mastra/core/mastra';

describe('MastraService', () => {
  beforeEach(() => {
    // Reset the memoized in-flight build promise between cases.
    (MastraService as any)._mastraPromise = null;
  });

  it('registers only the postmill agent at the top level', async () => {
    const loadToolsService = new (LoadToolsService as any)();
    const mastraService = new MastraService(loadToolsService);

    const mastra = await mastraService.mastra();
    const agents = mastra.listAgents();

    expect(Object.keys(agents)).toEqual(['postmill']);
    expect(agents.postmill.id).toBe('postmill');
  });

  it('reuses the cached Mastra instance across calls', async () => {
    const loadToolsService = new (LoadToolsService as any)();
    const mastraService = new MastraService(loadToolsService);

    const first = await mastraService.mastra();
    const second = await mastraService.mastra();

    expect(first).toBe(second);
    expect(loadToolsService.agent).toHaveBeenCalledTimes(1);
  });

  // 2.2 — a rejected first build must NOT be memoized forever; the next call rebuilds.
  it('rebuilds after a rejected build instead of caching the rejection', async () => {
    const loadToolsService = new (LoadToolsService as any)();
    loadToolsService.agent = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient store failure'))
      .mockResolvedValueOnce({ id: 'postmill', name: 'postmill' });

    const mastraService = new MastraService(loadToolsService);

    await expect(mastraService.mastra()).rejects.toThrow('transient store failure');

    // Second call rebuilds (cache was reset on rejection) and succeeds.
    const mastra = await mastraService.mastra();
    expect(mastra.listAgents().postmill.id).toBe('postmill');
    expect(loadToolsService.agent).toHaveBeenCalledTimes(2);
  });

  // Concurrent first-callers of a FAILING build both reject; the build still ran once.
  it('rejects all concurrent awaiters of a failed build, then rebuilds next time', async () => {
    const loadToolsService = new (LoadToolsService as any)();
    loadToolsService.agent = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ id: 'postmill', name: 'postmill' });

    const mastraService = new MastraService(loadToolsService);

    const [a, b] = await Promise.allSettled([
      mastraService.mastra(),
      mastraService.mastra(),
    ]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    // Both concurrent callers shared the single in-flight build.
    expect(loadToolsService.agent).toHaveBeenCalledTimes(1);

    // A later call rebuilds successfully.
    const mastra = await mastraService.mastra();
    expect(mastra.listAgents().postmill.id).toBe('postmill');
    expect(loadToolsService.agent).toHaveBeenCalledTimes(2);
  });
});

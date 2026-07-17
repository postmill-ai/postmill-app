import { Mastra } from '@mastra/core/mastra';
import { ConsoleLogger } from '@mastra/core/logger';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { Injectable } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';

@Injectable()
export class MastraService {
  // Memoize the in-flight PROMISE, not the resolved value: two concurrent first
  // callers would otherwise both see the cache empty, both `await agent()`, and
  // both `new Mastra(...)` — double-building and double-registering in-process
  // handlers. Caching the promise makes the build happen exactly once.
  private static _mastraPromise: Promise<Mastra> | null = null;

  constructor(private _loadToolsService: LoadToolsService) {}

  async mastra() {
    if (!MastraService._mastraPromise) {
      const build = (async () =>
        new Mastra({
          storage: pStore,
          agents: {
            postmill: await this._loadToolsService.agent(),
          },
          logger: new ConsoleLogger({
            level: 'info',
          }),
        }))();

      // Memoize the in-flight promise, but reset the cache if the build REJECTS
      // (transient DB error in Memory/pStore) so the next caller rebuilds instead
      // of receiving the same permanently-rejected promise. Concurrent awaiters of
      // this build still all reject together; the identity check (against the cached
      // wrapper itself) stops a late rejection from clobbering a newer build.
      const wrapped: Promise<Mastra> = build.catch((e) => {
        if (MastraService._mastraPromise === wrapped) {
          MastraService._mastraPromise = null;
        }
        throw e;
      });
      MastraService._mastraPromise = wrapped;
    }

    return MastraService._mastraPromise;
  }
}

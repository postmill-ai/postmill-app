import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { AgentRegistrySchema } from '@reaatech/agent-mesh-registry';
import { CONTENT_PIPELINE_AGENTS } from './pipeline-registry.data';

/**
 * Boot-time validation for the content-pipeline agent registry.
 *
 * This module deliberately touches NONE of the agent-mesh process-global
 * singletons (`registryState`, `setSessionStore`, `setBreakerStore`): those are
 * shared with the AI Designer mesh, and swapping/setting them here would clobber
 * the AI Designer's config (last module to init wins). Instead:
 *   - the conductor resolves agent configs from `CONTENT_PIPELINE_AGENTS`
 *     directly (see `ContentPipelineConductorService._agentMap`), and
 *   - agents register uniquely-namespaced (`content-pipeline-*`) in-process
 *     handlers, so the shared `handlers` map never collides.
 * All the pipeline needs at boot is a sanity-check that the bundled registry is
 * schema-valid; failure is non-fatal (log-and-degrade — this is a @Global()
 * module imported by ChatModule, so a throw would crash the backend).
 */
@Global()
@Module({})
export class ContentPipelineMeshModule implements OnModuleInit {
  private readonly _logger = new Logger(ContentPipelineMeshModule.name);

  onModuleInit() {
    const parsed = AgentRegistrySchema.safeParse(CONTENT_PIPELINE_AGENTS);
    if (!parsed.success) {
      this._logger.error(
        `Content-pipeline agent registry invalid: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(
            '; '
          )} — content pipeline will be degraded until this is resolved`
      );
    }
  }
}

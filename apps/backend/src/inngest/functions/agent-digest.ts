import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { AgentDigestActivity } from '@gitroom/nestjs-libraries/inngest/activities/agent-digest.activity';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

export const createAgentDigest = (
  // The cron fan-out only reads org ids; the activity is threaded in solely to
  // keep this factory's arity aligned with its sibling and the shared caller.
  _agentDigestActivity: AgentDigestActivity,
  organizationService: OrganizationService
) =>
  inngest.createFunction(
    { id: 'agent-digest', concurrency: 1 },
    { cron: 'TZ=America/New_York 0 7 * * 1' },
    async ({ step }) => {
      if (process.env.AGENT_DIGEST_ENABLED !== 'true') {
        return { skipped: true, reason: 'AGENT_DIGEST_ENABLED not set to true' };
      }

      const orgIds = await step.run('get-org-ids', () =>
        organizationService.getAllIds().then((rows) => rows.map((r) => r.id))
      );

      if (orgIds.length > 0) {
        await step.sendEvent(
          'fan-out-agent-digest',
          orgIds.map((organizationId) => ({
            name: 'agent/digest-org' as const,
            data: { organizationId },
          }))
        );
      }

      return { fannedOut: orgIds.length };
    }
  );

export const createAgentDigestOrg = (agentDigestActivity: AgentDigestActivity) =>
  inngest.createFunction(
    { id: 'agent-digest-org', concurrency: 2 },
    { event: 'agent/digest-org' },
    async ({ step, event }) => {
      const { organizationId } = event.data;

      // Two steps so an ack-loss retry of the notify step never re-runs the LLM
      // (second spend / orphan thread). The threadId is minted inside generate,
      // so it is memoized and the notify replay reuses the same thread link.
      const digest = await step.run('generate-digest', () =>
        agentDigestActivity.generate(organizationId)
      );

      // step.run's return type serializes every field to optional; guard the
      // threadId so the skipped path and the notify hand-off stay well-typed.
      if (digest.skipped || !digest.threadId) {
        return digest;
      }

      const { threadId, title, message } = digest;
      return step.run('notify', () =>
        agentDigestActivity.notify(organizationId, {
          threadId,
          notified: false,
          title,
          message,
        })
      );
    }
  );
